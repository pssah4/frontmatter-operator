/**
 * WikilinkDedupCleanupService -- App-backed shell around the pure
 * WikilinkDedup core. Scans notes (the whole vault, or a given subset
 * for the table's selection-based Bulk action), collapses frontmatter
 * wikilinks that resolve to the same file, and rewrites the survivors
 * to Obsidian's canonical shortest form. Snapshot-undoable via the
 * shared SnapshotService.
 *
 * Mirrors the RefusalTagCleanupService skeleton (vault loop, cached
 * frontmatter read, write queue, dry-run short-circuit, snapshot,
 * processFrontMatter writeback) but swaps the decision block for the
 * dedup core and fixes two issues that service has: it uses the correct
 * snapshots.save({action, entries}) API (valid, reloadable id) and
 * wraps each write in a try/catch for skip-on-error semantics.
 */

import { TFile, type App } from "obsidian";
import type { SnapshotService } from "./SnapshotService";
import type { Frontmatter } from "../types";
import { dedupeWikilinkValue, type LinkResolver } from "./WikilinkDedup";
import { triggerBatchEvent, FM_BATCH_START, FM_BATCH_END } from "../batchEvents";

/** Frontmatter keys we never touch. */
const RESERVED_KEYS = new Set(["position", "tags-meta"]);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface DedupOptions {
  /** Restrict the scan to these note paths (selection-based run). */
  paths?: string[];
  /** Restrict the scan to a single frontmatter property. */
  property?: string;
  dryRun?: boolean;
  onProgress?: (current: number, total: number, file: TFile) => void;
}

export interface DedupReport {
  notesScanned: number;
  notesTouched: number;
  duplicatesRemoved: number;
  linksRewritten: number;
  propertiesAffected: Record<string, number>;
  perNote: Array<{
    path: string;
    property: string;
    removed: string[];
    rewritten: Array<{ from: string; to: string }>;
  }>;
  errors: Array<{ path: string; message: string }>;
  snapshotId?: string;
}

export class WikilinkDedupCleanupService {
  constructor(
    private app: App,
    private snapshots: SnapshotService,
  ) {}

  async run(opts: DedupOptions = {}): Promise<DedupReport> {
    triggerBatchEvent(this.app, FM_BATCH_START);
    try {
      return await this.runInner(opts);
    } finally {
      triggerBatchEvent(this.app, FM_BATCH_END);
    }
  }

  private async runInner(opts: DedupOptions = {}): Promise<DedupReport> {
    const dryRun = opts.dryRun ?? false;
    const files = this.resolveFiles(opts.paths);
    const perNote: DedupReport["perNote"] = [];
    const propertiesAffected: Record<string, number> = {};
    const errors: DedupReport["errors"] = [];

    interface PendingWrite {
      file: TFile;
      patches: Array<{ property: string; nextValue: unknown }>;
    }
    const writeQueue: PendingWrite[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      opts.onProgress?.(i + 1, files.length, file);
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;

      // Resolution is anchored at the note that holds the link, so a
      // bare "[[Name]]" resolves exactly as Obsidian renders it here.
      const resolve = this.resolverFor(file);

      const propsToScan = opts.property
        ? [opts.property]
        : Object.keys(fm).filter(
            (k) => !RESERVED_KEYS.has(k) && !UNSAFE_KEYS.has(k),
          );

      const patches: PendingWrite["patches"] = [];
      for (const prop of propsToScan) {
        const raw = fm[prop];
        if (raw === undefined || raw === null) continue;
        const result = dedupeWikilinkValue(raw, resolve);
        if (!result.changed) continue;
        patches.push({ property: prop, nextValue: result.next });
        perNote.push({
          path: file.path,
          property: prop,
          removed: result.removed,
          rewritten: result.rewritten,
        });
        propertiesAffected[prop] = (propertiesAffected[prop] ?? 0) + 1;
      }

      if (patches.length > 0) writeQueue.push({ file, patches });
    }

    const report: DedupReport = {
      notesScanned: files.length,
      notesTouched: writeQueue.length,
      duplicatesRemoved: perNote.reduce((a, e) => a + e.removed.length, 0),
      linksRewritten: perNote.reduce((a, e) => a + e.rewritten.length, 0),
      propertiesAffected,
      perNote,
      errors,
    };

    if (dryRun || writeQueue.length === 0) return report;

    // Snapshot every touched note's COMPLETE frontmatter so undo
    // restores the exact pre-cleanup state (restoreSnapshot replays
    // `before` verbatim, not a diff). Use the typed save() overload so
    // SnapshotService assigns a valid, reloadable id.
    const entries = writeQueue.map(({ file }) => {
      const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
      return {
        path: file.path,
        before: cached
          ? (JSON.parse(JSON.stringify(cached)) as Frontmatter)
          : null,
      };
    });
    const snap = await this.snapshots.save({
      action: { type: "delete", properties: Object.keys(propertiesAffected) },
      entries,
    });

    for (const { file, patches } of writeQueue) {
      try {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          for (const patch of patches) {
            if (UNSAFE_KEYS.has(patch.property)) continue;
            fm[patch.property] = patch.nextValue as never;
          }
        });
      } catch (err) {
        errors.push({
          path: file.path,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    report.snapshotId = snap.id;
    return report;
  }

  private resolveFiles(paths?: string[]): TFile[] {
    if (!paths) return this.app.vault.getMarkdownFiles();
    return paths
      .map((p) => this.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile);
  }

  private resolverFor(file: TFile): LinkResolver {
    return (target) => {
      const dest = this.app.metadataCache.getFirstLinkpathDest(
        target,
        file.path,
      );
      if (!dest) return null;
      return {
        id: dest.path,
        canonical: this.app.metadataCache.fileToLinktext(dest, file.path, true),
      };
    };
  }
}
