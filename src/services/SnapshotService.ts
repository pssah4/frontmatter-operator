import type { App, Vault } from "obsidian";
import type { Snapshot, BulkAction, Frontmatter } from "../types";

const SNAPSHOT_DIR = ".frontmatter-editor/snapshots";
const MAX_SNAPSHOTS = 50;

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
    const file = `${SNAPSHOT_DIR}/${snap.id}.json`;
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
        const snap = JSON.parse(raw) as Snapshot;
        snaps.push(snap);
      } catch (err) {
        console.warn("frontmatter-editor: failed to read snapshot", f, err);
      }
    }
    return snaps.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<Snapshot | null> {
    const file = `${SNAPSHOT_DIR}/${id}.json`;
    if (!(await this.adapter.exists(file))) return null;
    try {
      const raw = await this.adapter.read(file);
      return JSON.parse(raw) as Snapshot;
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    const file = `${SNAPSHOT_DIR}/${id}.json`;
    if (await this.adapter.exists(file)) {
      await this.adapter.remove(file);
    }
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
