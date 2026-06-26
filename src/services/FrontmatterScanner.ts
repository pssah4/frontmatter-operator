import type { App, TFile } from "obsidian";
import type { Frontmatter, NoteRow, PropertyStat, ScanResult } from "../types";

const SAMPLE_LIMIT = 8;

function valueType(
  v: unknown,
): "string" | "number" | "boolean" | "list" | "object" | "null" {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "list";
  if (typeof v === "object") return "object";
  if (typeof v === "string") return "string";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "string";
}

function stringifySample(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v))
    return "[" + v.slice(0, 3).map((x) => stringifySample(x)).join(", ") + "]";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export class FrontmatterScanner {
  constructor(private app: App) {}

  getAllMarkdownFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  readFrontmatter(file: TFile): Frontmatter | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm || typeof fm !== "object") return null;
    const copy: Frontmatter = {};
    for (const [k, v] of Object.entries(fm)) {
      if (k === "position") continue;
      copy[k] = v as Frontmatter[string];
    }
    return copy;
  }

  scan(): ScanResult {
    const files = this.getAllMarkdownFiles();
    const propMap = new Map<
      string,
      { count: number; samples: string[]; types: PropertyStat["types"] }
    >();
    let withFm = 0;

    for (const file of files) {
      const fm = this.readFrontmatter(file);
      if (!fm) continue;
      withFm++;
      for (const [key, value] of Object.entries(fm)) {
        let entry = propMap.get(key);
        if (!entry) {
          entry = { count: 0, samples: [], types: new Set() };
          propMap.set(key, entry);
        }
        entry.count++;
        entry.types.add(valueType(value));
        if (entry.samples.length < SAMPLE_LIMIT) {
          const s = stringifySample(value);
          if (!entry.samples.includes(s)) entry.samples.push(s);
        }
      }
    }

    const properties: PropertyStat[] = Array.from(propMap.entries())
      .map(([name, info]) => ({
        name,
        count: info.count,
        sampleValues: info.samples,
        types: info.types,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return {
      totalNotes: files.length,
      notesWithFrontmatter: withFm,
      properties,
    };
  }

  buildRows(files: TFile[]): NoteRow[] {
    const rows: NoteRow[] = [];
    for (const file of files) {
      const fm = this.readFrontmatter(file);
      rows.push({
        file,
        path: file.path,
        basename: file.basename,
        frontmatter: fm ?? {},
      });
    }
    return rows;
  }

  buildAllRows(): NoteRow[] {
    return this.buildRows(this.getAllMarkdownFiles());
  }

  getPropertyValues(
    rows: NoteRow[],
    property: string,
    limit = 200,
  ): Array<{ value: string; count: number }> {
    const counter = new Map<string, number>();
    for (const row of rows) {
      const v = row.frontmatter[property];
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          const s = typeof item === "string" ? item : String(item);
          counter.set(s, (counter.get(s) ?? 0) + 1);
        }
      } else {
        const s = typeof v === "string" ? v : String(v);
        counter.set(s, (counter.get(s) ?? 0) + 1);
      }
    }
    return Array.from(counter.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, limit);
  }
}
