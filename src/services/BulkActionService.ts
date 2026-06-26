import { TFile, type App } from "obsidian";
import type {
  ActionPreview,
  ActionResult,
  BulkAction,
  FmValue,
  Frontmatter,
  NoteRow,
  Snapshot,
} from "../types";
import {
  mergeListValues,
  resolveTemplate,
  wrapAsWikilink,
} from "./ValueCoercion";
import type { SnapshotService } from "./SnapshotService";

// HARD-04: deny these as frontmatter property keys to prevent silent
// prototype-chain reassignment on the per-note frontmatter object during
// processFrontMatter or applyActionPure clones.
const DISALLOWED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isAllowedKey(key: string): boolean {
  return key.length > 0 && !DISALLOWED_KEYS.has(key);
}

function cloneFrontmatter(fm: Frontmatter): Frontmatter {
  return JSON.parse(JSON.stringify(fm));
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "string") return v.length === 0;
  return false;
}

export function applyActionPure(
  fm: Frontmatter,
  action: BulkAction,
): { after: Frontmatter; changed: boolean; skipped?: string } {
  const after = cloneFrontmatter(fm);

  switch (action.type) {
    case "set": {
      if (!isAllowedKey(action.property)) {
        return {
          after,
          changed: false,
          skipped: `property name "${action.property}" is reserved`,
        };
      }
      const exists = Object.prototype.hasOwnProperty.call(after, action.property);
      if (exists && action.mode === "skip_if_exists") {
        return { after, changed: false, skipped: "property already set" };
      }
      const resolved = action.template && typeof action.value === "string"
        ? resolveTemplate(action.value, fm)
        : action.value;
      if (action.template && (resolved === null || resolved === "")) {
        return {
          after,
          changed: false,
          skipped: "template resolves to empty",
        };
      }
      const coerced = action.wrapWikilink ? wrapAsWikilink(resolved) : resolved;
      if (exists && action.mode === "merge_list") {
        after[action.property] = mergeListValues(
          after[action.property],
          coerced,
        );
      } else {
        after[action.property] = coerced;
      }
      return {
        after,
        changed: JSON.stringify(after[action.property]) !==
          JSON.stringify(fm[action.property]),
      };
    }

    case "delete": {
      const props = (action.properties ?? []).filter(isAllowedKey);
      let changed = false;
      for (const p of props) {
        if (Object.prototype.hasOwnProperty.call(after, p)) {
          delete after[p];
          changed = true;
        }
      }
      if (!changed) {
        return { after, changed: false, skipped: "no matching property" };
      }
      return { after, changed: true };
    }

    case "rename":
    case "copy":
    case "move": {
      if (!isAllowedKey(action.toProperty)) {
        return {
          after,
          changed: false,
          skipped: `target property "${action.toProperty}" is reserved`,
        };
      }
      const sourceProps = action.fromProperties
        .filter(isAllowedKey)
        .filter((p) => Object.prototype.hasOwnProperty.call(after, p));
      if (sourceProps.length === 0) {
        return { after, changed: false, skipped: "no source property present" };
      }

      const collected = sourceProps.map((p) => after[p]);
      let merged: FmValue =
        collected.length === 1
          ? collected[0]
          : collected.reduce(
              (acc, v) => mergeListValues(acc, v),
              [] as FmValue,
            );

      if (action.wrapWikilink) merged = wrapAsWikilink(merged);

      const targetExists = Object.prototype.hasOwnProperty.call(
        after,
        action.toProperty,
      );
      if (targetExists && !isEmpty(after[action.toProperty])) {
        if (action.onConflict === "skip") {
          return { after, changed: false, skipped: "target property exists" };
        }
        if (action.onConflict === "merge_list") {
          merged = mergeListValues(after[action.toProperty], merged);
        }
      }

      after[action.toProperty] = merged;

      if (action.type !== "copy") {
        for (const p of sourceProps) {
          if (p !== action.toProperty) delete after[p];
        }
      }
      return { after, changed: true };
    }
  }
}

export class BulkActionService {
  constructor(
    private app: App,
    private snapshots: SnapshotService,
  ) {}

  previewAction(rows: NoteRow[], action: BulkAction): ActionPreview[] {
    const previews: ActionPreview[] = [];
    for (const row of rows) {
      const { after, changed, skipped } = applyActionPure(
        row.frontmatter,
        action,
      );
      previews.push({
        path: row.path,
        before: row.frontmatter,
        after,
        changed,
        skippedReason: skipped,
      });
    }
    return previews;
  }

  async executeAction(
    rows: NoteRow[],
    action: BulkAction,
    onProgress?: (current: number, total: number) => void,
  ): Promise<ActionResult> {
    const result: ActionResult = {
      successCount: 0,
      skippedCount: 0,
      errorCount: 0,
      errors: [],
    };

    // HARD-08: write the snapshot BEFORE any mutation, derived from the
    // dry-run preview. Rows where applyActionPure predicts no change are
    // skipped without being recorded. If the executor crashes (Obsidian
    // killed, plugin disabled mid-run), the snapshot is already on disk
    // and the user can restore the affected notes from it.
    const predictedChanges: Array<{ row: NoteRow; entry: Snapshot["entries"][number] }> = [];
    for (const row of rows) {
      const probe = applyActionPure(row.frontmatter, action);
      if (probe.changed) {
        predictedChanges.push({
          row,
          entry: {
            path: row.path,
            before: cloneFrontmatter(row.frontmatter),
          },
        });
      }
    }
    const skippedUpfront = rows.length - predictedChanges.length;
    result.skippedCount = skippedUpfront;

    let snap: Snapshot | null = null;
    if (predictedChanges.length > 0) {
      snap = await this.snapshots.save({
        action,
        entries: predictedChanges.map((p) => p.entry),
      });
      result.snapshotId = snap.id;
    }

    let done = 0;
    const total = predictedChanges.length;
    for (const { row } of predictedChanges) {
      try {
        await this.writeFrontmatter(row.file, action);
        result.successCount++;
      } catch (err) {
        result.errorCount++;
        result.errors.push({
          path: row.path,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      done++;
      onProgress?.(done, total);
    }

    return result;
  }

  async restoreSnapshot(
    snapshot: Snapshot,
    onProgress?: (current: number, total: number) => void,
  ): Promise<ActionResult> {
    const result: ActionResult = {
      successCount: 0,
      skippedCount: 0,
      errorCount: 0,
      errors: [],
    };
    const total = snapshot.entries.length;
    for (let i = 0; i < total; i++) {
      const entry = snapshot.entries[i];
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      // HARD-05: instanceof TFile instead of the duck-type ("extension" in file)
      // check -- correctly rejects TFolder and any future abstract subtype.
      if (!(file instanceof TFile)) {
        result.errorCount++;
        result.errors.push({
          path: entry.path,
          message: "file not found",
        });
        continue;
      }
      try {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          for (const k of Object.keys(fm)) delete fm[k];
          if (entry.before) {
            for (const [k, v] of Object.entries(entry.before)) {
              if (!isAllowedKey(k)) continue;
              fm[k] = v as unknown;
            }
          }
        });
        result.successCount++;
      } catch (err) {
        result.errorCount++;
        result.errors.push({
          path: entry.path,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      onProgress?.(i + 1, total);
    }
    return result;
  }

  private async writeFrontmatter(
    file: TFile,
    action: BulkAction,
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      switch (action.type) {
        case "set": {
          if (!isAllowedKey(action.property)) return;
          const exists = Object.prototype.hasOwnProperty.call(
            fm,
            action.property,
          );
          if (exists && action.mode === "skip_if_exists") return;
          const resolved = action.template && typeof action.value === "string"
            ? resolveTemplate(action.value, fm as never)
            : action.value;
          if (action.template && (resolved === null || resolved === "")) return;
          const coerced = action.wrapWikilink
            ? wrapAsWikilink(resolved as FmValue)
            : resolved;
          if (exists && action.mode === "merge_list") {
            fm[action.property] = mergeListValues(
              fm[action.property] as never,
              coerced as FmValue,
            );
          } else {
            fm[action.property] = coerced;
          }
          return;
        }
        case "delete": {
          for (const p of action.properties ?? []) {
            if (!isAllowedKey(p)) continue;
            if (Object.prototype.hasOwnProperty.call(fm, p)) {
              delete fm[p];
            }
          }
          return;
        }
        case "rename":
        case "copy":
        case "move": {
          if (!isAllowedKey(action.toProperty)) return;
          const sourceProps = action.fromProperties
            .filter(isAllowedKey)
            .filter((p) => Object.prototype.hasOwnProperty.call(fm, p));
          if (sourceProps.length === 0) return;
          const collected = sourceProps.map((p) => fm[p]);
          let merged: FmValue =
            collected.length === 1
              ? (collected[0] as FmValue)
              : (collected.reduce(
                  (acc, v) => mergeListValues(acc as FmValue, v as FmValue),
                  [] as FmValue,
                ) as FmValue);
          if (action.wrapWikilink) merged = wrapAsWikilink(merged);

          const targetExists = Object.prototype.hasOwnProperty.call(
            fm,
            action.toProperty,
          );
          if (targetExists && !isEmpty(fm[action.toProperty])) {
            if (action.onConflict === "skip") return;
            if (action.onConflict === "merge_list") {
              merged = mergeListValues(
                fm[action.toProperty] as FmValue,
                merged,
              );
            }
          }
          fm[action.toProperty] = merged;
          if (action.type !== "copy") {
            for (const p of sourceProps) {
              if (p !== action.toProperty) delete fm[p];
            }
          }
          return;
        }
      }
    });
  }
}
