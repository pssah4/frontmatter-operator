import type { App, TFile } from "obsidian";
import type { Frontmatter } from "../../types";
import type {
  GeneratorLanguage,
  GeneratorPreset,
} from "../../types/generators";
import type { ProviderConfig } from "../../types/llm";
import { buildApiHandler } from "../../api/ProviderRegistry";
import { parseResponse } from "./parsers";

export interface GeneratorRunResult {
  successCount: number;
  skippedCount: number;
  errorCount: number;
  errors: Array<{ path: string; message: string }>;
}

export interface GeneratorRunOptions {
  preset: GeneratorPreset;
  provider: ProviderConfig;
  language: GeneratorLanguage;
  /** Notes to process. */
  targets: TFile[];
  /** Optional, used by the moc preset to ground the LLM in existing topics. */
  knownTopics?: string[];
  knownConcepts?: string[];
  /** Called for each note as we advance. */
  onProgress?: (current: number, total: number, file: TFile) => void;
  /** If true, skip notes that already have the target property. Default: false (overwrite/merge). */
  skipIfPropertyExists?: boolean;
}

const MAX_BODY_CHARS = 12_000;

export class GeneratorService {
  constructor(private app: App) {}

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
    };
    const handler = buildApiHandler(opts.provider);
    const prompts = opts.preset.prompts[opts.language];
    if (!prompts) {
      throw new Error(
        `Preset ${opts.preset.id} has no prompt for language ${opts.language}`,
      );
    }

    for (let i = 0; i < opts.targets.length; i++) {
      const file = opts.targets[i];
      opts.onProgress?.(i + 1, opts.targets.length, file);
      try {
        if (opts.skipIfPropertyExists) {
          const meta = this.app.metadataCache.getFileCache(file);
          const existing = meta?.frontmatter?.[opts.preset.targetProperty];
          if (existing !== undefined && existing !== null && existing !== "") {
            result.skippedCount++;
            continue;
          }
        }

        const body = await this.readNoteBody(file);
        const userPrompt = interpolate(prompts.userPrompt, {
          NOTE_BODY: body.slice(0, MAX_BODY_CHARS),
          NOTE_TITLE: file.basename,
          KNOWN_TOPICS: (opts.knownTopics ?? []).join(", "),
          KNOWN_CONCEPTS: (opts.knownConcepts ?? []).join(", "),
        });

        const completion = await handler.complete({
          systemPrompt: prompts.systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          model: opts.provider.defaultModel,
        });

        const parsed = parseResponse(opts.preset.parser, completion.text);
        if (!parsed.ok) {
          result.errorCount++;
          result.errors.push({
            path: file.path,
            message: `parse failed: ${parsed.error}`,
          });
          continue;
        }

        await this.applyToFrontmatter(file, opts.preset.targetProperty, parsed.value, opts.preset.parser);
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
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
      if (parserId === "moc_topics_concepts") {
        const payload = value as { topics: string[]; concepts: string[] };
        const existingRaw = fm[property];
        const existing =
          existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
            ? (existingRaw as { topics?: unknown; concepts?: unknown })
            : { topics: [], concepts: [] };
        const mergedTopics = mergeStringLists(
          arr(existing.topics),
          payload.topics,
        );
        const mergedConcepts = mergeStringLists(
          arr(existing.concepts),
          payload.concepts,
        );
        fm[property] = {
          topics: mergedTopics,
          concepts: mergedConcepts,
        } as never;
        return;
      }
      if (parserId === "list_string") {
        const existing = arr(fm[property]);
        const incoming = Array.isArray(value) ? (value as unknown[]).map(String) : [];
        const merged = mergeStringLists(existing, incoming);
        fm[property] = merged as never;
        return;
      }
      // single_line_text
      const existing = fm[property];
      if (existing === undefined || existing === null || existing === "") {
        fm[property] = value as never;
      } else if (typeof existing === "string" && existing.length === 0) {
        fm[property] = value as never;
      }
      // Note: for descriptions we deliberately do NOT overwrite existing text.
      // The user can clear it manually if they want a regeneration.
    });
  }
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
