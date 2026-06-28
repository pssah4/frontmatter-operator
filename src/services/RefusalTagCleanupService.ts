/**
 * RefusalTagCleanupService -- one-shot maintenance scan that finds
 * notes whose `tags` (or any other list-typed) frontmatter property
 * was polluted by a pre-detector Generate-with-AI run and silently
 * cleans them, snapshot-undoable.
 *
 * Triggered by the plugin command "Clean refusal text from tags
 * across the vault" (added in main.ts) and by the Maintenance button
 * in Settings. Not part of the BulkAction discriminated union --
 * this is a one-shot cleanup, not a composable user action.
 *
 * Filter logic per item:
 *   1. If looksLikeKeyword(item) === false -> drop. Catches sentence-
 *      shaped strings ("Based on the note content...", "I need to
 *      see...") that no real keyword could ever produce.
 *   2. If item's lowercase contains any KNOWN_REFUSAL_SUBSTRINGS ->
 *      drop. Catches refusals that happen to fit the keyword shape
 *      but are still obvious refusals ("unable to generate").
 *
 * If the WHOLE list reads as a refusal via listLooksLikeRefusal,
 * drop every item (saves the noise of partial cleanups on fully
 * polluted notes).
 */

import type { App, TFile } from "obsidian";
import type { SnapshotService } from "./SnapshotService";
import type { Frontmatter, Snapshot } from "../types";
import {
  KNOWN_REFUSAL_SUBSTRINGS,
  isRefusalItem,
  listLooksLikeRefusal,
} from "./generator/GeneratorService";

export interface CleanupReport {
  notesScanned: number;
  notesTouched: number;
  itemsRemoved: number;
  /** Per-note removal log; empty when dryRun=true and no removals. */
  perNote: Array<{ path: string; removed: string[] }>;
  /** Snapshot id (when dryRun=false and any note was touched). */
  snapshotId?: string;
}

export interface CleanupOptions {
  /** Frontmatter key to scan. Default "tags". */
  property?: string;
  /** If true, count what WOULD be removed without writing. */
  dryRun?: boolean;
  /** Progress callback per file (current, total, file). */
  onProgress?: (current: number, total: number, file: TFile) => void;
}

export class RefusalTagCleanupService {
  constructor(
    private app: App,
    private snapshots: SnapshotService,
  ) {}

  async run(opts: CleanupOptions = {}): Promise<CleanupReport> {
    const property = opts.property ?? "tags";
    const dryRun = opts.dryRun ?? false;
    const files = this.app.vault.getMarkdownFiles();
    const perNote: CleanupReport["perNote"] = [];
    const writeQueue: Array<{ file: TFile; clean: string[]; before: unknown }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      opts.onProgress?.(i + 1, files.length, file);
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;
      const raw = fm[property];
      if (!Array.isArray(raw)) continue;
      const items = raw.map((v) => (typeof v === "string" ? v : String(v)));
      if (items.length === 0) continue;

      // Decide what to keep.
      const wholeList = listLooksLikeRefusal(items);
      const clean = wholeList ? [] : items.filter((it) => !isRefusalItem(it));
      const removed = items.filter((it) => !clean.includes(it));
      if (removed.length === 0) continue;

      perNote.push({ path: file.path, removed });
      writeQueue.push({
        file,
        clean,
        before: raw,
      });
    }

    const report: CleanupReport = {
      notesScanned: files.length,
      notesTouched: writeQueue.length,
      itemsRemoved: perNote.reduce((acc, e) => acc + e.removed.length, 0),
      perNote,
    };

    if (dryRun || writeQueue.length === 0) return report;

    // Snapshot before any write so the whole batch is one undoable op.
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
    // Use a synthesized "delete" action shape so the existing
    // SnapshotsModal renders something readable for the entry; the
    // actual undo replay restores `before` per entry regardless of
    // the action shape (see BulkActionService.restoreSnapshot).
    const snap: Snapshot = {
      id: snapshotId,
      createdAt: new Date().toISOString(),
      action: { type: "delete", properties: [property] },
      entries: snapshotEntries,
    };
    await this.snapshots.save(snap);

    // Now do the writes.
    for (const entry of writeQueue) {
      await this.app.fileManager.processFrontMatter(entry.file, (fm) => {
        if (entry.clean.length === 0) {
          delete fm[property];
        } else {
          fm[property] = entry.clean as never;
        }
      });
    }

    report.snapshotId = snapshotId;
    return report;
  }
}

// Re-export so the cleanup command + settings tab can import only
// from this file.
export { KNOWN_REFUSAL_SUBSTRINGS };
