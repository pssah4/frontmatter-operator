import type { App, Vault } from "obsidian";
import type { Snapshot, BulkAction, Frontmatter } from "../types";
import { BULK_ACTION_TYPES } from "../types";

// M-7 (AUDIT 2026-06-29): snapshot dir was previously vault-relative
// (".frontmatter-editor/snapshots") so every snapshot got mirrored to
// iCloud/Dropbox/Git/Syncthing along with the rest of the vault --
// each snapshot contains pre-mutation frontmatter the user wanted
// removed. Moving under vault.configDir/plugins/frontmatter-operator/
// keeps the snapshots adjacent to data.json and inherits Obsidian's
// own plugin-data exclusion from sync. The legacy path is migrated
// on first call to ensureDir() so existing snapshots are preserved.
const LEGACY_SNAPSHOT_DIR = ".frontmatter-editor/snapshots";
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
  // H-5 (AUDIT 2026-06-29): derive the allow-list from
  // BULK_ACTION_TYPES so a newly-added action type can't silently
  // disappear from disk-loaded snapshots. The previous hard-coded
  // tuple missed "transfer" entirely, breaking Undo across restarts
  // for the primary new action type.
  if (typeof action.type !== "string") return null;
  if (!(BULK_ACTION_TYPES as readonly string[]).includes(action.type)) {
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

  /**
   * Plugin-private snapshot dir. Under vault.configDir/plugins/...
   * so it inherits Obsidian's exclusion from vault sync. Lazy --
   * uses app.vault.configDir which is the path Obsidian itself uses
   * for its own state, so respects the user's vault override too.
   */
  private get snapshotDir(): string {
    return `${this.vault.configDir}/plugins/frontmatter-operator/snapshots`;
  }

  async ensureDir(): Promise<void> {
    if (!(await this.adapter.exists(this.snapshotDir))) {
      await this.adapter.mkdir(this.snapshotDir);
    }
    // M-7 migration: move every snapshot file from the legacy
    // vault-relative dir to the new plugin-private one, then delete
    // the legacy dir. Idempotent: if the legacy dir is missing, do
    // nothing. Runs on every save's ensureDir but the existence
    // check makes it free after the first migration.
    await this.migrateLegacySnapshots();
  }

  private async migrateLegacySnapshots(): Promise<void> {
    // Two historical locations are migrated into the current plugin-private
    // dir on first ensureDir():
    //   1. ".frontmatter-editor/snapshots" -- the pre-M-7 vault-relative dir.
    //   2. "<configDir>/plugins/frontmatter-editor/snapshots" -- the pre-
    //      rebrand plugin folder (the plugin id was "frontmatter-editor"
    //      before it became "frontmatter-operator"). After the rebrand the
    //      plugin installs under a new folder, orphaning these snapshots.
    // Idempotent: missing sources are skipped, and a source that resolves to
    // the current snapshotDir is skipped.
    await this.migrateFrom(LEGACY_SNAPSHOT_DIR, true);
    await this.migrateFrom(
      `${this.vault.configDir}/plugins/frontmatter-editor/snapshots`,
      false,
    );
  }

  /**
   * Move every *.json snapshot from `src` into the current snapshotDir, then
   * remove `src` if it is left empty. When `cleanupVaultRootParent` is set,
   * also removes the legacy ".frontmatter-editor" parent folder if empty.
   */
  private async migrateFrom(
    src: string,
    cleanupVaultRootParent: boolean,
  ): Promise<void> {
    if (src === this.snapshotDir) return;
    if (!(await this.adapter.exists(src))) return;
    try {
      const listing = await this.adapter.list(src);
      for (const f of listing.files) {
        if (!f.endsWith(".json")) continue;
        const name = f.split("/").pop()!;
        const dest = `${this.snapshotDir}/${name}`;
        if (await this.adapter.exists(dest)) {
          await this.adapter.remove(f);
          continue;
        }
        try {
          const raw = await this.adapter.read(f);
          await this.adapter.write(dest, raw);
          await this.adapter.remove(f);
        } catch (err) {
          console.warn(
            "frontmatter-operator: snapshot migration failed for",
            f,
            err,
          );
        }
      }
      const after = await this.adapter.list(src);
      if (after.files.length === 0 && after.folders.length === 0) {
        await this.adapter.rmdir(src, false);
        if (cleanupVaultRootParent) {
          // Try to delete the parent .frontmatter-editor folder too if it's
          // now empty -- it was created solely for this snapshot dir.
          const parent = ".frontmatter-editor";
          if (await this.adapter.exists(parent)) {
            const parentListing = await this.adapter.list(parent);
            if (
              parentListing.files.length === 0 &&
              parentListing.folders.length === 0
            ) {
              await this.adapter.rmdir(parent, false);
            }
          }
        }
      }
    } catch (err) {
      console.warn(
        "frontmatter-operator: snapshot migration failed (will retry)",
        err,
      );
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
    if (!(await this.adapter.exists(this.snapshotDir))) return [];
    const listing = await this.adapter.list(this.snapshotDir);
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
            "frontmatter-operator: snapshot has invalid shape, skipping",
            f,
          );
        }
      } catch (err) {
        console.warn("frontmatter-operator: failed to read snapshot", f, err);
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
    return `${this.snapshotDir}/${id}.json`;
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
