import type { App, TFile } from "obsidian";
import type { Frontmatter } from "../../types";
import type {
  GeneratorLanguage,
  GeneratorPreset,
} from "../../types/generators";
import type { ProviderConfig, RunModelOptions } from "../../types/llm";
import { buildApiHandler } from "../../api/ProviderRegistry";
import type FrontmatterEditorPlugin from "../../main";
import { parseResponse } from "./parsers";

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
    const result: GeneratorRunResult = {
      successCount: 0,
      skippedCount: 0,
      errorCount: 0,
      errors: [],
      skipped: [],
    };
    const conflictMode: GeneratorConflictMode = opts.conflictMode ?? "skip";
    const handler = await buildApiHandler(opts.provider, opts.model, this.plugin);
    const prompts = opts.preset.prompts[opts.language];
    if (!prompts) {
      throw new Error(
        `Preset ${opts.preset.id} has no prompt for language ${opts.language}`,
      );
    }

    for (let i = 0; i < opts.targets.length; i++) {
      const file = opts.targets[i];
      opts.onProgress?.(i + 1, opts.targets.length, file);

      // ---- conflict gate ----
      if (conflictMode === "skip") {
        const meta = this.app.metadataCache.getFileCache(file);
        const existing = meta?.frontmatter?.[opts.preset.targetProperty];
        if (!isEmptyExisting(existing)) {
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

      const userPrompt = interpolate(prompts.userPrompt, {
        NOTE_BODY: body.slice(0, MAX_BODY_CHARS),
        NOTE_TITLE: file.basename,
        KNOWN_TOPICS: (opts.knownTopics ?? []).join(", "),
        KNOWN_CONCEPTS: (opts.knownConcepts ?? []).join(", "),
      });

      // ---- API call: skip on transport/auth errors (don't fail the
      //                  whole run because one note 4xx'd) ----
      let completionText: string;
      try {
        const completion = await handler.complete({
          systemPrompt: prompts.systemPrompt,
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
              : "LLM refused to generate a value (note may be empty or off-topic)",
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

      try {
        await this.applyToFrontmatter(
          file,
          opts.preset.targetProperty,
          parsed.value,
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
          } as never;
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
        } as never;
        return;
      }
      if (parserId === "list_string") {
        const incoming = Array.isArray(value) ? (value as unknown[]).map(String) : [];
        if (conflictMode === "overwrite" || targetEmpty) {
          fm[property] = incoming as never;
          return;
        }
        // append (or skip-with-race): merge
        fm[property] = mergeStringLists(arr(existingRaw), incoming) as never;
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
 * Catches two classes:
 *   1. The model emits our requested sentinel UNABLE_TO_GENERATE.
 *   2. The model ignores the instruction and produces prose-style
 *      refusal: "I cannot...", "Sorry I am unable...", "I need to see
 *      the active note...", "since no note content was shared",
 *      "I'll wait for the note content", "Based on the note content
 *      provided...", "Please share the note content", "Without the
 *      actual note...", plus German variants. Match on prefix OR
 *      anywhere in a short response so list-formatted refusals
 *      ("- I need to see...\n- I'll wait...") still trip.
 * Length cap (600 chars) keeps long, real answers safe.
 */
export function looksLikeRefusal(text: string): boolean {
  const trimmed = text.trim();
  // Direct sentinel hit -- model played by the rules.
  if (trimmed === REFUSAL_SENTINEL || trimmed.includes(REFUSAL_SENTINEL)) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  if (lower.length > 600) return false; // a long answer is an answer
  // Prefix patterns (legacy + the new ones the user actually saw).
  const prefixPatterns = [
    /^i (cannot|can't|am unable to|am not able to)\b/,
    /^sorry,? i (cannot|can't|am unable)/,
    /^there is (no|nothing) (content|information|text) (to|that)/,
    /^the (note|document|file) (is|appears to be) empty/,
    /^cannot generate/,
    /^unable to generate/,
    /^(ich kann|leider kann ich) (das|dies)? ?nicht/,
    /^die notiz (ist|scheint) leer/,
  ];
  if (prefixPatterns.some((re) => re.test(lower))) return true;
  // Anywhere-in-text patterns: catches list-shaped refusals where
  // each item is one of these phrasings. The phrases are specific
  // enough to never appear in a real description or keyword.
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
  return anywherePatterns.some((re) => re.test(lower));
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

function looksLikeKeyword(item: string): boolean {
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
      // eslint-disable-next-line @typescript-eslint/no-use-before-define -- ref is captured by the listener closure below
      app.metadataCache.offref(ref);
      clearTimeout(timer);
      resolve();
    };
    const ref = app.metadataCache.on("changed", (changed) => {
      if (changed.path === file.path) finish();
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}
