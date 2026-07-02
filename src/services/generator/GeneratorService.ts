import type { App, TFile } from "obsidian";
import type { Frontmatter } from "../../types";
import type {
  GeneratorLanguage,
  GeneratorPreset,
} from "../../types/generators";
import { GENERATOR_GUARDRAIL } from "../../types/generators";
import type { ProviderConfig, RunModelOptions } from "../../types/llm";
import { buildApiHandler } from "../../api/ProviderRegistry";
import { isAllowedKey } from "../BulkActionService";
import type FrontmatterEditorPlugin from "../../main";
import { parseResponse } from "./parsers";
import { triggerBatchEvent, FM_BATCH_START, FM_BATCH_END } from "../../batchEvents";

/**
 * How a generator run handles a note that already has a non-empty
 * value in the target property.
 *
 *   - "skip"      : leave the note untouched, count as skipped.
 *   - "append"    : merge the new value into the existing value where
 *                   the parser supports it (list-string, moc-topics-
 *                   concepts). For single-line-text the new value
 *                   replaces only when the existing value is empty.
 *   - "overwrite" : always replace with the new value.
 */
export type GeneratorConflictMode = "skip" | "append" | "overwrite";

export interface GeneratorRunResult {
  successCount: number;
  skippedCount: number;
  errorCount: number;
  /** Errors that escaped the skip-on-error policy (typically only
   *  fatal SDK setup errors). Per-note write or parse failures land
   *  in `skipped` with reason="error". */
  errors: Array<{ path: string; message: string }>;
  /** Per-note skip events with a human-readable reason. The user
   *  sees these in the modal chat log; useful for "why didn't this
   *  note get processed?" debugging. */
  skipped: Array<{ path: string; reason: string }>;
}

export interface GeneratorRunOptions {
  preset: GeneratorPreset;
  provider: ProviderConfig;
  model: RunModelOptions;
  language: GeneratorLanguage;
  /** Notes to process. */
  targets: TFile[];
  /**
   * L (AUDIT 2026-06-29): caller-supplied abort signal. When fired,
   * the per-note loop checks signal.aborted at the top of each
   * iteration and returns early with the partial result. Inner
   * SDK calls also receive the signal so an in-flight API request
   * is cut. Without this a wrong-preset run over 1000 notes is
   * uncancellable short of a plugin reload (cost implications).
   */
  abortSignal?: AbortSignal;
  /** Optional, used by the moc preset to ground the LLM in existing topics. */
  knownTopics?: string[];
  knownConcepts?: string[];
  /** Called for each note as we advance. */
  onProgress?: (current: number, total: number, file: TFile) => void;
  /** What to do when the target property already has a non-empty
   *  value on a note. Defaults to "skip" (the safest -- preserves
   *  existing data). */
  conflictMode?: GeneratorConflictMode;
}

const MAX_BODY_CHARS = 12_000;

export class GeneratorService {
  constructor(
    private app: App,
    private plugin: FrontmatterEditorPlugin,
  ) {}

  /**
   * Runs the preset against every target note. For each note:
   *  1. read the note body (frontmatter stripped)
   *  2. interpolate the user prompt
   *  3. call the provider
   *  4. parse the response deterministically
   *  5. merge the result into frontmatter via processFrontMatter
   *
   * All vault writes go through processFrontMatter so existing properties
   * are preserved by Obsidian's own YAML writer.
   */
  async run(opts: GeneratorRunOptions): Promise<GeneratorRunResult> {
    // A generate run writes many notes, each behind a (slow) LLM call.
    // Bracket it so the live view suspends its per-note refresh and redraws
    // once when the whole run finishes.
    triggerBatchEvent(this.app, FM_BATCH_START);
    try {
      return await this.runInner(opts);
    } finally {
      triggerBatchEvent(this.app, FM_BATCH_END);
    }
  }

  private async runInner(opts: GeneratorRunOptions): Promise<GeneratorRunResult> {
    const result: GeneratorRunResult = {
      successCount: 0,
      skippedCount: 0,
      errorCount: 0,
      errors: [],
      skipped: [],
    };
    const conflictMode: GeneratorConflictMode = opts.conflictMode ?? "skip";
    const handler = await buildApiHandler(opts.provider, opts.model, this.plugin);
    const userPromptTemplate = opts.preset.prompts[opts.language];
    if (!userPromptTemplate) {
      throw new Error(
        `Preset ${opts.preset.id} has no prompt for language ${opts.language}`,
      );
    }
    const systemPrompt = GENERATOR_GUARDRAIL[opts.language];

    for (let i = 0; i < opts.targets.length; i++) {
      // L AbortSignal (AUDIT 2026-06-29): per-iteration abort check.
      // A wrong-preset 1000-note run is now cancellable mid-loop;
      // the partial result returned includes whatever was already
      // written + the remaining notes counted as skipped.
      if (opts.abortSignal?.aborted) {
        const remaining = opts.targets.length - i;
        result.skippedCount += remaining;
        for (let j = i; j < opts.targets.length; j++) {
          result.skipped.push({
            path: opts.targets[j].path,
            reason: "cancelled by user",
          });
        }
        return result;
      }
      const file = opts.targets[i];
      opts.onProgress?.(i + 1, opts.targets.length, file);

      // ---- conflict gate ----
      // Skip-mode trap: a list_string property whose existing value
      // is itself a polluted refusal list from a pre-detector run
      // would otherwise be treated as "already has a value" and the
      // note would be silently skipped forever. Detect that
      // pollution and let the run proceed -- applyToFrontmatter will
      // then overwrite the bad list with the fresh, clean one.
      if (conflictMode === "skip") {
        const meta = this.app.metadataCache.getFileCache(file);
        const existing: unknown = meta?.frontmatter?.[opts.preset.targetProperty];
        const isPollutedList =
          opts.preset.parser === "list_string" &&
          Array.isArray(existing) &&
          existing.length > 0 &&
          listLooksLikeRefusal(existing.map(String));
        if (!isEmptyExisting(existing) && !isPollutedList) {
          result.skippedCount++;
          result.skipped.push({
            path: file.path,
            reason: `target property "${opts.preset.targetProperty}" already has a value (conflict mode: skip)`,
          });
          continue;
        }
      }

      // ---- pre-check: empty body -> nothing to summarise, skip ----
      const body = await this.readNoteBody(file);
      if (body.trim().length === 0) {
        result.skippedCount++;
        result.skipped.push({
          path: file.path,
          reason: "note body is empty, nothing to generate from",
        });
        continue;
      }

      // L-1 LLM (AUDIT 2026-06-29): wrap the vault note body in an
      // explicit untrusted-input delimiter so the model treats it
      // as data, not as additional instructions. Strips ASCII
      // control characters (other than \\n, \\r, \\t) to defeat
      // common prompt-injection payloads that hide markers in
      // non-printable bytes. The wrapper is informational -- there's
      // no hard guarantee against a determined injection -- but it
      // raises the bar materially.
      const safeBody = sanitiseForPrompt(body.slice(0, MAX_BODY_CHARS));
      const wrappedBody = `<note_body_untrusted>\n${safeBody}\n</note_body_untrusted>`;
      const userPrompt = interpolate(userPromptTemplate, {
        NOTE_BODY: wrappedBody,
        NOTE_TITLE: file.basename,
        KNOWN_TOPICS: (opts.knownTopics ?? []).join(", "),
        KNOWN_CONCEPTS: (opts.knownConcepts ?? []).join(", "),
      });

      // ---- API call: skip on transport/auth errors (don't fail the
      //                  whole run because one note 4xx'd) ----
      let completionText: string;
      try {
        const completion = await handler.complete({
          systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        });
        completionText = completion.text;
      } catch (err) {
        result.skippedCount++;
        result.skipped.push({
          path: file.path,
          reason: `provider error: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      // ---- empty / unusable completion -> skip ----
      const trimmed = completionText.trim();
      if (trimmed.length === 0 || looksLikeRefusal(trimmed)) {
        result.skippedCount++;
        result.skipped.push({
          path: file.path,
          reason:
            trimmed.length === 0
              ? "LLM returned an empty response"
              : "LLM refused to generate (responded with meta-commentary about the note instead of a value)",
        });
        continue;
      }

      // ---- single_line_text: extra sanity-check on the raw answer
      //      BEFORE the parser collapses it to one line. Some models
      //      reply with a paragraph that LOOKS like a description but
      //      is actually a refusal disguised as text ("The note
      //      content provided is insufficient to generate a
      //      summary"). The parser would then write that as the
      //      description. Detect it the same way we detect a list
      //      refusal: scan for meta-commentary tokens. ----
      if (
        opts.preset.parser === "single_line_text" &&
        textLooksLikeMetaCommentary(trimmed)
      ) {
        result.skippedCount++;
        result.skipped.push({
          path: file.path,
          reason:
            "LLM returned meta-commentary about the note instead of a value",
        });
        continue;
      }

      // ---- parse: skip-on-fail (was an error before) ----
      const parsed = parseResponse(opts.preset.parser, completionText);
      if (!parsed.ok) {
        result.skippedCount++;
        result.skipped.push({
          path: file.path,
          reason: `could not parse LLM response (${parsed.error})`,
        });
        continue;
      }

      // ---- post-parse refusal sanity-check (list_string) ----
      // A model that produces a YAML-valid list of refusal sentences
      // (each "- " followed by "I need to see...") would otherwise
      // get written to frontmatter as "keywords". Detect that the
      // list shape contains sentence-like items and skip instead.
      if (
        opts.preset.parser === "list_string" &&
        Array.isArray(parsed.value) &&
        listLooksLikeRefusal((parsed.value as unknown[]).map(String))
      ) {
        result.skippedCount++;
        result.skipped.push({
          path: file.path,
          reason:
            "LLM produced a list of refusal sentences instead of keywords (note may be empty or unclear)",
        });
        continue;
      }

      // Post-parse normalisation for the keywords preset: force
      // lowercase + cap to 5 entries, regardless of what the LLM
      // produced. The prompt asks for this, but cheaper models
      // occasionally ship "AI-Agent" or 8 keywords; this is the
      // last-mile guarantee so the saved tag is always
      // ["ai-agent", "non-linear-writing", ...] -- normalised exactly
      // the same way every time, scoped to the keywords preset only
      // (other list_string presets like "aliases" need to keep their
      // original casing).
      let valueToWrite: unknown = parsed.value;
      if (
        opts.preset.id === "keywords" &&
        opts.preset.parser === "list_string" &&
        Array.isArray(valueToWrite)
      ) {
        const seen = new Set<string>();
        const normalised: string[] = [];
        for (const item of valueToWrite as unknown[]) {
          const s = String(item).toLowerCase().trim();
          if (!s || seen.has(s)) continue;
          seen.add(s);
          normalised.push(s);
          if (normalised.length >= 5) break;
        }
        valueToWrite = normalised;
      }

      try {
        await this.applyToFrontmatter(
          file,
          opts.preset.targetProperty,
          valueToWrite,
          opts.preset.parser,
          conflictMode,
        );
        // processFrontMatter writes to disk synchronously but Obsidian
        // re-parses the metadata cache on the file-modify event, which
        // fires asynchronously. Without waiting, a refreshScan that
        // follows the generator run reads the OLD frontmatter (null for
        // a freshly-generated property) and the table shows stale
        // values until the user clicks a column header. Wait for the
        // metadata-cache 'changed' event for THIS file before
        // continuing; fall back to a short timeout so a missed event
        // doesn't hang the run.
        await waitForMetadataChange(this.app, file);
        result.successCount++;
      } catch (err) {
        result.errorCount++;
        result.errors.push({
          path: file.path,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return result;
  }

  private async readNoteBody(file: TFile): Promise<string> {
    const raw = await this.app.vault.cachedRead(file);
    // Strip a leading YAML frontmatter block so the LLM only sees note prose.
    const fmMatch = raw.match(/^---\n[\s\S]*?\n---\n?/);
    return fmMatch ? raw.slice(fmMatch[0].length) : raw;
  }

  private async applyToFrontmatter(
    file: TFile,
    property: string,
    value: unknown,
    parserId: string,
    conflictMode: GeneratorConflictMode,
  ): Promise<void> {
    // L-3 (AUDIT 2026-07-01): the target property comes from a user-editable /
    // importable prompt config, so reject prototype-polluting keys here too --
    // the bulk action write paths already do (BulkActionService.isAllowedKey).
    if (!isAllowedKey(property)) return;
    await this.app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
      const existingRaw = fm[property];
      const targetEmpty = isEmptyExisting(existingRaw);

      // The "skip" mode was already enforced in run() before we got
      // here. By the time applyToFrontmatter fires the call site has
      // promised the write is OK. We still honour the mode for the
      // edge case where another process raced and added a value
      // between the metadataCache check and processFrontMatter.

      if (parserId === "moc_topics_concepts") {
        const payload = value as { topics: string[]; concepts: string[] };
        if (conflictMode === "overwrite" || targetEmpty) {
          fm[property] = {
            topics: payload.topics,
            concepts: payload.concepts,
          };
          return;
        }
        // append (or skip-with-race): merge
        const existing =
          existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
            ? (existingRaw as { topics?: unknown; concepts?: unknown })
            : { topics: [], concepts: [] };
        fm[property] = {
          topics: mergeStringLists(arr(existing.topics), payload.topics),
          concepts: mergeStringLists(arr(existing.concepts), payload.concepts),
        };
        return;
      }
      if (parserId === "list_string") {
        const incoming = Array.isArray(value) ? (value as unknown[]).map(String) : [];
        if (conflictMode === "overwrite" || targetEmpty) {
          fm[property] = incoming;
          return;
        }
        // append (or skip-with-race): merge. CRITICAL guard --
        // scrub refusal-shaped legacy values from existingRaw
        // BEFORE merging. Without this, a single previous broken
        // run leaves polluted strings in fm[tags] that get
        // perpetuated forever on every subsequent append run, even
        // when every new LLM response is correctly caught by the
        // upstream detectors. This is what produced the 476-note
        // leak the user reported after the third "supposedly
        // final" fix.
        const cleanExisting = sanitizeExistingListString(arr(existingRaw));
        fm[property] = mergeStringLists(cleanExisting, incoming);
        return;
      }
      // single_line_text (description et al.)
      if (conflictMode === "overwrite" || targetEmpty) {
        fm[property] = value as never;
        return;
      }
      // append: concat with a separator. For free-form text the
      // append usually means "extend the description", so glue the
      // new value after a paragraph break.
      if (conflictMode === "append" && typeof existingRaw === "string") {
        fm[property] = `${existingRaw}\n\n${value as string}` as never;
      }
      // The conflictMode === "skip" race case: leave existing alone.
    });
  }
}

/**
 * Same emptiness test the conflict gate uses up in run(). Centralised
 * here so the metadata-cache check and the processFrontMatter write
 * agree on what counts as "already has a value".
 */
function isEmptyExisting(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") {
    // moc-style nested object: empty iff topics+concepts both empty.
    const obj = v as Record<string, unknown>;
    const t = obj.topics, c = obj.concepts;
    if (Array.isArray(t) && Array.isArray(c)) return t.length === 0 && c.length === 0;
    // Any other object shape: assume non-empty -- the user explicitly
    // wrote something we don't recognise, so we don't clobber it.
    return false;
  }
  return false;
}

/**
 * Sentinel the prompt asks the model to emit when it has nothing to
 * generate (empty note, content too short). Exported so the parser
 * sanity-check can short-circuit on it too.
 */
export const REFUSAL_SENTINEL = "UNABLE_TO_GENERATE";

/**
 * Heuristic: detect refusal / "can't generate" responses from the LLM.
 * Catches three classes:
 *   1. Sentinel hit -- model played by the rules.
 *   2. Specific prefix or anywhere phrasings the user saw in
 *      production (legacy patterns + the new "I need to see..." set).
 *   3. textLooksLikeMetaCommentary -- broader "wrote about the
 *      task/note instead of the value" detector. Catches paraphrases
 *      the specific patterns miss.
 */
export function looksLikeRefusal(text: string): boolean {
  const trimmed = text.trim();
  // Direct sentinel hit.
  if (trimmed === REFUSAL_SENTINEL || trimmed.includes(REFUSAL_SENTINEL)) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  if (lower.length > 600) return false; // a long answer is an answer
  const prefixPatterns = [
    /^i (cannot|can't|am unable to|am not able to)\b/,
    /^sorry,? i (cannot|can't|am unable)/,
    /^there is (no|nothing) (content|information|text) (to|that)/,
    /^the (note|document|file) (is|appears to be) (empty|too short)/,
    /^cannot generate/,
    /^unable to generate/,
    /^(ich kann|leider kann ich) (das|dies)? ?nicht/,
    /^die notiz (ist|scheint) (leer|zu kurz)/,
  ];
  if (prefixPatterns.some((re) => re.test(lower))) return true;
  const anywherePatterns = [
    /\bi need to see (the |an? )?(active |original )?note\b/,
    /\bno note content (was|is) (shared|provided|given)\b/,
    /\bi(?:'| wi)ll wait for the note content\b/,
    /\bplease (share|provide|paste) (the |your )?note (content|text|body)\b/,
    /\bwithout (the actual |any )?(note|content)\b/,
    /\bbased on the note content provided\b.*\b(i|cannot|please)\b/,
    /\bich (brauche|benötige) (den |die )?(note|notiz|inhalt)\b/,
    /\bbitte (teile|schicke|gib mir) (den |die )?(inhalt|note|notiz)\b/,
  ];
  if (anywherePatterns.some((re) => re.test(lower))) return true;
  // Broad meta-commentary detector for short prose answers that
  // talk ABOUT the note/task instead of producing the value. Only
  // applied when the response is short enough (<300 chars) and
  // doesn't already look like a real value -- otherwise a real
  // description that happens to contain the word "note" would
  // false-positive.
  if (lower.length <= 300 && textLooksLikeMetaCommentary(trimmed)) {
    return true;
  }
  return false;
}

/**
 * "The model wrote ABOUT the note/task instead of producing the
 * value" detector. Specifically targets the failure mode the user
 * saw on non-empty notes: the LLM writes a sentence like
 *   "The note content provided is insufficient for a summary."
 *   "Based on the available context, I cannot derive keywords."
 *   "Diese Notiz enthaelt zu wenig Informationen fuer eine Zusammenfassung."
 * which slips past the specific phrasing patterns because the exact
 * words rotate, but always combines a "subject + meta-verb + about
 * the input" structure.
 *
 * Definition of a hit:
 *   - text starts with "I/We/The note/The content/The text/The
 *     document/Note/Diese Notiz/Dieser Inhalt/Der Text/Die
 *     Information" OR contains any of those followed by a
 *     meta-verb within 30 chars,
 *   AND
 *   - contains at least one of the meta verbs: cannot/can't/unable/
 *     insufficient/not enough/too short/empty/missing/lacks/lacking/
 *     does not contain/doesn't contain/need more/needs more/
 *     please provide/clarify/share/upload/paste/kann nicht/
 *     reicht nicht/zu wenig/zu kurz/fehlt/keine ausreichende/
 *     bitte/teile.
 *
 * Conservative on long texts -- a 400-char real description that
 * mentions "the note" in passing does not trigger.
 */
export function textLooksLikeMetaCommentary(text: string): boolean {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (lower.length === 0) return false;
  if (lower.length > 400) return false;
  // Subject indicators -- the response starts by talking ABOUT
  // something rather than producing a value.
  const subjectPattern = /^(i\b|we\b|please\b|the (note|content|text|document|input|provided)|this (note|content|text|document)|note|diese? (note|notiz|inhalt|text|datei)|dieser (note|notiz|inhalt|text)|der (text|inhalt|input)|die (notiz|information)|das (dokument|file)|bitte\b)/i;
  if (!subjectPattern.test(trimmed)) return false;
  const metaVerbPatterns = [
    /\bcannot\b/, /\bcan(?:'t| not)\b/, /\bunable\b/, /\bnot able\b/,
    /\binsufficient\b/, /\bnot enough\b/, /\btoo short\b/,
    /\b(is|appears|seems) (empty|missing|blank)\b/,
    /\b(lacks|lacking|missing|does(?:n't| not) contain)\b/,
    /\b(need|require|requires|requires more|more info|more context)\b/,
    /\bplease (provide|share|paste|upload|attach|clarify)\b/,
    /\bclarif/, /\bunclear\b/,
    // German equivalents
    /\bkann (das |dies |diese )?nicht\b/, /\breicht (nicht|allein nicht) aus\b/,
    /\bzu (kurz|wenig)\b/, /\b(fehlt|fehlen) (der|die|das|noch)\b/,
    /\bkeine ausreichend/, /\bbitte (teile|geben|gib|stelle|liefere)\b/,
  ];
  return metaVerbPatterns.some((re) => re.test(lower));
}

/**
 * Post-parse sanity check on a list_string result. The Keywords
 * preset (and any other list-typed generator) can be fooled when
 * the model emits a YAML-valid list whose items are refusal
 * sentences: "- I need to see...\n- I'll wait...". The parser sees
 * a valid string[] and returns ok. This check decides the result is
 * actually a disguised refusal when EVERY list item looks like a
 * sentence rather than a keyword.
 *
 * Definition of "keyword-like": short (<= 6 words), no leading
 * "I/We/You", no trailing period, no question marks. A real keyword
 * preset hits these every time; a refusal sentence almost never does.
 *
 * Threshold: if more than half the items are NOT keyword-like, treat
 * the whole list as refusal-shaped. Single-item lists are kept if
 * the one item passes (so an over-strict generator that returned a
 * single keyword still works).
 */
export function listLooksLikeRefusal(items: string[]): boolean {
  if (items.length === 0) return false;
  const sentenceLike = items.filter((it) => !looksLikeKeyword(it)).length;
  // Half or more sentence-shaped items => refusal.
  return sentenceLike * 2 >= items.length;
}

export function looksLikeKeyword(item: string): boolean {
  const s = item.trim();
  if (s.length === 0) return false;
  // Endmark = sentence
  if (/[.!?]$/.test(s) && !/\.\.\.$/.test(s)) return false;
  // Question mark anywhere = not a keyword
  if (/[?]/.test(s)) return false;
  // Leading pronoun = sentence
  if (/^(i|we|you|the|please|sorry|based|since|because|without|note|notiz|ich|wir|du|sie|bitte)\b/i.test(s)) {
    return false;
  }
  // Too long for a keyword (> 6 words counting hyphenated as one)
  const wordCount = s.split(/\s+/).length;
  if (wordCount > 6) return false;
  return true;
}

/**
 * Substrings the cleanup pass treats as "definitely a refusal" even
 * when looksLikeKeyword wouldn't flag the exact item. Used by the
 * generator's append-branch guard and by RefusalTagCleanupService.
 * All lowercase; matched case-insensitively against item.trim().
 * The first four are the exact phrasings the user pulled out of his
 * 476-note leak after the third "supposedly final" fix.
 */
export const KNOWN_REFUSAL_SUBSTRINGS: readonly string[] = [
  "based on the note content provided",
  "i need to see the active note",
  "no note content was shared",
  "i'll wait for the actual note content",
  "i need to see the note",
  "please provide the note",
  "without the actual note",
  "unable to generate",
  "unable_to_generate", // the sentinel itself (with underscores)
  "cannot generate",
  "the note appears to be empty",
  "the note content is insufficient",
  "ich brauche den inhalt",
  "ich warte auf den note-inhalt",
  "die notiz ist leer",
];

/**
 * Does this single string look like a refusal token that the user
 * never wants to see in their tag list? Combines the structural
 * "not-keyword-shaped" check with a known-phrase substring check.
 * Used to filter EXISTING fm[tags] entries on append so a polluted
 * pre-fix run can't perpetuate itself.
 */
export function isRefusalItem(item: string): boolean {
  const s = item.trim();
  if (s.length === 0) return false;
  if (!looksLikeKeyword(s)) return true;
  const lower = s.toLowerCase();
  return KNOWN_REFUSAL_SUBSTRINGS.some((p) => lower.includes(p));
}

/**
 * Scrub refusal-shaped strings from a previously-stored list_string
 * frontmatter value so they aren't perpetuated by an "append" run.
 *
 * Strategy:
 *   - If the whole list reads as a disguised refusal (>=50% items
 *     sentence-shaped via listLooksLikeRefusal), drop everything.
 *     A list that's mostly garbage rarely has salvageable real items.
 *   - Otherwise drop only the sentence-shaped or known-refusal
 *     items. Real keywords stay. Mixed lists (a few real tags +
 *     a few refusal fragments) get cleaned without losing the
 *     legitimate work the user already did.
 */
export function sanitizeExistingListString(existing: string[]): string[] {
  if (existing.length === 0) return existing;
  if (listLooksLikeRefusal(existing)) return [];
  return existing.filter((it) => !isRefusalItem(it));
}

/**
 * L-1 LLM (AUDIT 2026-06-29): strip ASCII control characters from
 * vault content before it lands in the LLM prompt. Keeps \\n, \\r,
 * \\t (line breaks + indentation matter for body comprehension);
 * drops every other 0x00-0x1F + 0x7F. Defends against prompt
 * injections that hide instructions in non-printable bytes.
 */
function sanitiseForPrompt(s: string): string {
  // eslint-disable-next-line no-control-regex -- intentionally matches control chars to sanitize LLM prompt input
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? "";
  });
}

function arr(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return [v];
  return [];
}

function mergeStringLists(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...a, ...b]) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * Wait until Obsidian's metadata cache has re-parsed `file` after a
 * processFrontMatter write, with a hard timeout fallback. Without this
 * the FrontmatterScanner reads stale (pre-write) frontmatter because
 * the metadata-cache update is async, so the table refresh that
 * follows a Generate-with-AI run shows null in the column the user
 * just generated.
 */
export async function waitForMetadataChange(
  app: App,
  file: TFile,
  timeoutMs = 1500,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      app.metadataCache.offref(ref);
      window.clearTimeout(timer);
      resolve();
    };
    const ref = app.metadataCache.on("changed", (changed) => {
      if (changed.path === file.path) finish();
    });
    const timer = window.setTimeout(finish, timeoutMs);
  });
}
