import type { App, Vault } from "obsidian";
import type { Snapshot, BulkAction, Frontmatter } from "../types";

const SNAPSHOT_DIR = ".frontmatter-editor/snapshots";
const MAX_SNAPSHOTS = 50;

// HARD-01: strict snapshot id format. Generated ids follow YYYYMMDD-HHMMSS-XXXX
// (4 alphanumeric chars). Anything else is rejected before path concatenation.
const SNAPSHOT_ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{2,16}$/;

export function isValidSnapshotId(id: unknown): id is string {
  return typeof id === "string" && SNAPSHOT_ID_RE.test(id);
}

// HARD-02: runtime shape validation for snapshot JSON read from disk. Returns
// null when the shape is wrong; callers must treat null as "discard, do not
// restore, do not delete via embedded id".
export function parseSnapshot(raw: unknown): Snapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isValidSnapshotId(o.id)) return null;
  if (typeof o.createdAt !== "string" || isNaN(Date.parse(o.createdAt))) {
    return null;
  }
  if (!o.action || typeof o.action !== "object") return null;
  const action = o.action as { type?: unknown };
  if (
    action.type !== "set" &&
    action.type !== "delete" &&
    action.type !== "rename" &&
    action.type !== "copy" &&
    action.type !== "move"
  ) {
    return null;
  }
  if (!Array.isArray(o.entries)) return null;
  for (const e of o.entries as unknown[]) {
    if (!e || typeof e !== "object") return null;
    const entry = e as Record<string, unknown>;
    if (typeof entry.path !== "string" || entry.path.length === 0) return null;
    if (entry.before !== null && (typeof entry.before !== "object" || Array.isArray(entry.before))) {
      return null;
    }
  }
  return o as unknown as Snapshot;
}

export class SnapshotService {
  constructor(private app: App) {}

  private get vault(): Vault {
    return this.app.vault;
  }

  private get adapter() {
    return this.vault.adapter;
  }

  async ensureDir(): Promise<void> {
    if (!(await this.adapter.exists(SNAPSHOT_DIR))) {
      await this.adapter.mkdir(SNAPSHOT_DIR);
    }
  }

  private nextId(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const rnd = Math.random().toString(36).slice(2, 6);
    return `${ts}-${rnd}`;
  }

  async save(payload: {
    action: BulkAction;
    entries: Array<{ path: string; before: Frontmatter | null }>;
  }): Promise<Snapshot> {
    await this.ensureDir();
    const snap: Snapshot = {
      id: this.nextId(),
      createdAt: new Date().toISOString(),
      action: payload.action,
      entries: payload.entries,
    };
    const file = this.pathFor(snap.id);
    await this.adapter.write(file, JSON.stringify(snap, null, 2));
    await this.prune();
    return snap;
  }

  async list(): Promise<Snapshot[]> {
    if (!(await this.adapter.exists(SNAPSHOT_DIR))) return [];
    const listing = await this.adapter.list(SNAPSHOT_DIR);
    const files = listing.files.filter((f) => f.endsWith(".json"));
    const snaps: Snapshot[] = [];
    for (const f of files) {
      try {
        const raw = await this.adapter.read(f);
        const parsed = parseSnapshot(JSON.parse(raw));
        if (parsed) {
          snaps.push(parsed);
        } else {
          console.debug(
            "frontmatter-editor: snapshot has invalid shape, skipping",
            f,
          );
        }
      } catch (err) {
        console.warn("frontmatter-editor: failed to read snapshot", f, err);
      }
    }
    return snaps.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<Snapshot | null> {
    if (!isValidSnapshotId(id)) return null;
    const file = this.pathFor(id);
    if (!(await this.adapter.exists(file))) return null;
    try {
      const raw = await this.adapter.read(file);
      return parseSnapshot(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    if (!isValidSnapshotId(id)) return;
    const file = this.pathFor(id);
    if (await this.adapter.exists(file)) {
      await this.adapter.remove(file);
    }
  }

  private pathFor(id: string): string {
    return `${SNAPSHOT_DIR}/${id}.json`;
  }

  private async prune(): Promise<void> {
    const snaps = await this.list();
    if (snaps.length <= MAX_SNAPSHOTS) return;
    const stale = snaps.slice(MAX_SNAPSHOTS);
    for (const s of stale) {
      await this.delete(s.id);
    }
  }
}
