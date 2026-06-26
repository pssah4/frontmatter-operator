import type { App, TFile } from "obsidian";
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
      if (!Object.prototype.hasOwnProperty.call(after, action.property)) {
        return { after, changed: false, skipped: "property absent" };
      }
      delete after[action.property];
      return { after, changed: true };
    }

    case "rename":
    case "copy":
    case "move": {
      const sourceProps = action.fromProperties.filter((p) =>
        Object.prototype.hasOwnProperty.call(after, p),
      );
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

    const snapshotEntries: Snapshot["entries"] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const beforeProbe = applyActionPure(row.frontmatter, action);
        if (!beforeProbe.changed) {
          result.skippedCount++;
          continue;
        }

        snapshotEntries.push({
          path: row.path,
          before: cloneFrontmatter(row.frontmatter),
        });

        await this.writeFrontmatter(row.file, action);
        result.successCount++;
      } catch (err) {
        result.errorCount++;
        result.errors.push({
          path: row.path,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      onProgress?.(i + 1, rows.length);
    }

    if (snapshotEntries.length > 0) {
      const snap = await this.snapshots.save({
        action,
        entries: snapshotEntries,
      });
      result.snapshotId = snap.id;
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
      if (!file || !("extension" in file)) {
        result.errorCount++;
        result.errors.push({
          path: entry.path,
          message: "file not found",
        });
        continue;
      }
      try {
        await this.app.fileManager.processFrontMatter(
          file as TFile,
          (fm) => {
            for (const k of Object.keys(fm)) delete fm[k];
            if (entry.before) {
              for (const [k, v] of Object.entries(entry.before)) {
                fm[k] = v as unknown;
              }
            }
          },
        );
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
          if (Object.prototype.hasOwnProperty.call(fm, action.property)) {
            delete fm[action.property];
          }
          return;
        }
        case "rename":
        case "copy":
        case "move": {
          const sourceProps = action.fromProperties.filter((p) =>
            Object.prototype.hasOwnProperty.call(fm, p),
          );
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
