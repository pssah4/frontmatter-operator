/**
 * RefusalTagCleanupService -- vault-wide scan that finds refusal-
 * shaped strings in any frontmatter property (not just `tags`) and
 * cleans them, snapshot-undoable.
 *
 * v2: scope expanded after the v1 "Nothing to clean" report --
 * pollution turned out to live in properties other than `tags` (or
 * as string values rather than arrays). The new pass:
 *   - inspects EVERY frontmatter key on every note (skip __virtual
 *     properties and the reserved `position` key)
 *   - for ARRAY values: per-item isRefusalItem filter
 *   - for STRING values: if the whole string looks like a refusal
 *     (looksLikeRefusal or contains a KNOWN_REFUSAL_SUBSTRING),
 *     delete the property entirely. If the string is a comma-
 *     separated chain of refusal sentences (the parser's fallback
 *     shape), the same check still catches it.
 *   - non-string/non-array values pass through untouched.
 * Empty values left over by the filter are deleted, not stored as
 * `[]` or `""`.
 *
 * Result includes a per-note breakdown and a per-property summary so
 * the user sees WHICH properties were affected -- a "tags + 0" report
 * was previously the only feedback when the leak lived elsewhere.
 *
 * Snapshot-undoable via existing SnapshotService.
 */

import type { App, TFile } from "obsidian";
import type { SnapshotService } from "./SnapshotService";
import type { FmValue, Frontmatter, Snapshot } from "../types";
import { triggerBatchEvent, FM_BATCH_START, FM_BATCH_END } from "../batchEvents";
import {
  KNOWN_REFUSAL_SUBSTRINGS,
  isRefusalItem,
  listLooksLikeRefusal,
  looksLikeRefusal,
} from "./generator/GeneratorService";
import { isAllowedKey } from "./BulkActionService";

/** Frontmatter keys we never touch even if they look suspicious. */
const RESERVED_KEYS = new Set(["position", "tags-meta"]);

/**
 * L-2 LLM (AUDIT 2026-06-29): default cleanup scope -- only the
 * properties that a generator preset can target. Without this, a
 * legitimate non-generator value containing one of the
 * KNOWN_REFUSAL_SUBSTRINGS phrases would be silently stripped on a
 * vault-wide scan. Pass `scope: "all"` to opt into the broader sweep
 * (legacy v2 behaviour) when a user explicitly suspects pollution in
 * other keys.
 */
const DEFAULT_TARGET_PROPERTIES: ReadonlySet<string> = new Set([
  "tags",
  "keywords",
  "aliases",
  "topics",
  "concepts",
  "moc",
  "description",
  "summary",
]);

export interface CleanupReport {
  notesScanned: number;
  notesTouched: number;
  itemsRemoved: number;
  propertiesAffected: Record<string, number>;
  /** Per-note removal log; empty when dryRun=true and no removals. */
  perNote: Array<{
    path: string;
    property: string;
    removed: string[];
    wholeStringRemoved?: string;
  }>;
  snapshotId?: string;
}

export interface CleanupOptions {
  /** If set, restrict the scan to this property. Overrides scope. */
  property?: string;
  /**
   * Default "targeted" -- scan only the curated set of properties
   * that a generator preset can write to (tags, keywords, aliases,
   * topics, concepts, moc, description, summary). Pass "all" to
   * scan every non-reserved frontmatter key on every note (the
   * legacy v2 behaviour, kept for the rare case where a user's
   * pollution lives outside the generator-target set).
   */
  scope?: "targeted" | "all";
  dryRun?: boolean;
  onProgress?: (current: number, total: number, file: TFile) => void;
}

export class RefusalTagCleanupService {
  constructor(
    private app: App,
    private snapshots: SnapshotService,
  ) {}

  async run(opts: CleanupOptions = {}): Promise<CleanupReport> {
    triggerBatchEvent(this.app, FM_BATCH_START);
    try {
      return await this.runInner(opts);
    } finally {
      triggerBatchEvent(this.app, FM_BATCH_END);
    }
  }

  private async runInner(opts: CleanupOptions = {}): Promise<CleanupReport> {
    const dryRun = opts.dryRun ?? false;
    const scopedProperty = opts.property;
    const scope = opts.scope ?? "targeted";
    const files = this.app.vault.getMarkdownFiles();
    const perNote: CleanupReport["perNote"] = [];
    const propertiesAffected: Record<string, number> = {};

    interface PendingWrite {
      file: TFile;
      patches: Array<{
        property: string;
        nextValue: unknown; // undefined = delete the key
      }>;
    }
    const writeQueue: PendingWrite[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      opts.onProgress?.(i + 1, files.length, file);
      const fm: Frontmatter | undefined =
        this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;

      const patches: PendingWrite["patches"] = [];
      const propsToScan = scopedProperty
        ? [scopedProperty]
        : Object.keys(fm).filter((k) => {
            if (RESERVED_KEYS.has(k)) return false;
            // L-2 LLM (AUDIT 2026-06-29): default scope is the
            // curated generator-target set, so a legitimate value
            // containing the words "cannot generate" elsewhere
            // doesn't get silently stripped. Opt into the full
            // sweep via scope: "all".
            if (scope === "targeted" && !DEFAULT_TARGET_PROPERTIES.has(k)) {
              return false;
            }
            return true;
          });

      for (const prop of propsToScan) {
        const raw = fm[prop];
        if (raw === undefined || raw === null) continue;

        // ---- array values ----
        if (Array.isArray(raw)) {
          const items = raw.map((v) => (typeof v === "string" ? v : String(v)));
          if (items.length === 0) continue;
          const wholeList = listLooksLikeRefusal(items);
          const clean = wholeList ? [] : items.filter((it) => !isRefusalItem(it));
          if (clean.length === items.length) continue;
          const removed = items.filter((it) => !clean.includes(it));
          patches.push({
            property: prop,
            nextValue: clean.length === 0 ? undefined : clean,
          });
          perNote.push({ path: file.path, property: prop, removed });
          propertiesAffected[prop] = (propertiesAffected[prop] ?? 0) + 1;
          continue;
        }

        // ---- string values ----
        if (typeof raw === "string") {
          const s = raw.trim();
          if (s.length === 0) continue;
          // Whole-string refusal? Drop the property.
          if (looksLikeRefusal(s) || isRefusalItem(s)) {
            patches.push({ property: prop, nextValue: undefined });
            perNote.push({
              path: file.path,
              property: prop,
              removed: [],
              wholeStringRemoved: s,
            });
            propertiesAffected[prop] = (propertiesAffected[prop] ?? 0) + 1;
            continue;
          }
          // Comma-separated chain of refusal sentences? Split + check.
          if (s.includes(",")) {
            const parts = s
              .split(",")
              .map((p) => p.trim())
              .filter((p) => p.length > 0);
            if (parts.length >= 2 && listLooksLikeRefusal(parts)) {
              patches.push({ property: prop, nextValue: undefined });
              perNote.push({
                path: file.path,
                property: prop,
                removed: parts,
                wholeStringRemoved: s,
              });
              propertiesAffected[prop] = (propertiesAffected[prop] ?? 0) + 1;
              continue;
            }
          }
        }
        // Other types (number, boolean, nested object) skipped.
      }

      if (patches.length > 0) writeQueue.push({ file, patches });
    }

    const report: CleanupReport = {
      notesScanned: files.length,
      notesTouched: writeQueue.length,
      itemsRemoved:
        perNote.reduce((acc, e) => acc + e.removed.length, 0) +
        perNote.filter((e) => e.wholeStringRemoved).length,
      propertiesAffected,
      perNote,
    };

    if (dryRun || writeQueue.length === 0) return report;

    // Snapshot every touched note's complete frontmatter so undo
    // restores the EXACT pre-cleanup state, regardless of which keys
    // we mutated. Uses the existing SnapshotService + the standard
    // restoreSnapshot replay path in BulkActionService.
    const snapshotId = `cleanup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const snapshotEntries: Snapshot["entries"] = writeQueue.map(({ file }) => {
      const cache = this.app.metadataCache.getFileCache(file);
      return {
        path: file.path,
        before: cache?.frontmatter
          ? (JSON.parse(JSON.stringify(cache.frontmatter)) as Frontmatter)
          : null,
      };
    });
    const snap: Snapshot = {
      id: snapshotId,
      createdAt: new Date().toISOString(),
      // Synthetic delete-shaped action so the existing snapshot UI
      // can render something readable; undo replays per-entry
      // `before` verbatim regardless of action shape.
      action: {
        type: "delete",
        properties: Object.keys(propertiesAffected),
      },
      entries: snapshotEntries,
    };
    await this.snapshots.save(snap);

    for (const { file, patches } of writeQueue) {
      await this.app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
        for (const patch of patches) {
          // I-3 (AUDIT 2026-07-02): parity with the other write paths
          // (BulkAction, Generator, inline edit) -- reject __proto__ /
          // constructor / prototype keys. patch.property comes from
          // Object.keys(fm) so this is a symmetry guard, not a reachable
          // exploit boundary, but it keeps the "isAllowedKey on every
          // write path" invariant intact.
          if (!isAllowedKey(patch.property)) continue;
          if (patch.nextValue === undefined) {
            delete fm[patch.property];
          } else {
            fm[patch.property] = patch.nextValue as FmValue;
          }
        }
      });
    }

    report.snapshotId = snapshotId;
    return report;
  }
}

export { KNOWN_REFUSAL_SUBSTRINGS };
