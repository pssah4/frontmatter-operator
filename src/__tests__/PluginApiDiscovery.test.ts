import { describe, it, expect } from "vitest";
import {
  FrontmatterEditorAPI,
  type NoteSelector,
} from "../api/FrontmatterEditorAPI";
import type { App } from "obsidian";
import type { FrontmatterScanner } from "../services/FrontmatterScanner";
import type { BulkActionService } from "../services/BulkActionService";
import type { SnapshotService } from "../services/SnapshotService";
import type { NoteRow } from "../types";

/**
 * Contract tests for the Vault Operator "plugin-as-skill" integration.
 *
 * Vault Operator discovers a plugin's JS API through TWO independent
 * reflection strategies that must BOTH see the same surface:
 *
 *  1. VaultDNAScanner.discoverPluginApi() walks the PROTOTYPE chain
 *     (Object.getPrototypeOf + getOwnPropertyNames). This is the
 *     authoritative gate for call_plugin_api (Tier-2 dynamic discovery).
 *
 *  2. ProbePluginTool.reflectApiMethods() reads OWN ENUMERABLE keys
 *     (Object.keys). This is the ADR-124 live-probe path the agent runs
 *     before the first call.
 *
 * The two helpers below replicate Vault Operator's exact logic so a
 * regression on our side (e.g. a method stops being discoverable) breaks
 * here instead of silently in the agent.
 */

// Mirror of obsidian-agent BLOCKED_METHODS (pluginApiAllowlist.ts) plus the
// scanner's 'constructor' guard (VaultDNAScanner.BLOCKED_API_METHODS).
const VAULT_OPERATOR_BLOCKED = new Set([
  "constructor",
  "execute",
  "executeJs",
  "render",
  "register",
  "unregister",
  "onload",
  "onunload",
  "destroy",
  "eval",
]);

/** Replicates VaultDNAScanner.discoverPluginApi (prototype-chain reflection). */
function discoverViaPrototype(api: object): string[] {
  const proto = Object.getPrototypeOf(api) as object;
  return Object.getOwnPropertyNames(proto)
    .filter(
      (m) =>
        !VAULT_OPERATOR_BLOCKED.has(m) &&
        typeof (api as Record<string, unknown>)[m] === "function" &&
        !m.startsWith("_"),
    )
    .sort();
}

/** Replicates ProbePluginTool.reflectApiMethods (Object.keys reflection). */
function discoverViaKeys(pluginInstance: Record<string, unknown>): string[] {
  const apiHolder =
    (pluginInstance.api as Record<string, unknown> | undefined) ??
    pluginInstance;
  const PLUGIN_BASE_METHODS = new Set([
    "onload",
    "onunload",
    "addCommand",
    "removeCommand",
    "addRibbonIcon",
    "addStatusBarItem",
    "addSettingTab",
    "registerView",
    "loadData",
    "saveData",
    "registerInterval",
    "registerEvent",
    "register",
  ]);
  const out: string[] = [];
  for (const key of Object.keys(apiHolder)) {
    if (key.startsWith("_")) continue;
    if (PLUGIN_BASE_METHODS.has(key)) continue;
    let value: unknown;
    try {
      value = apiHolder[key];
    } catch {
      continue;
    }
    if (typeof value !== "function") continue;
    out.push(key);
  }
  return out.sort();
}

function makeRows(paths: string[]): NoteRow[] {
  return paths.map((p) => ({
    file: {} as NoteRow["file"],
    path: p,
    basename: p.replace(/\.md$/, "").split("/").pop() ?? p,
    frontmatter: {},
  }));
}

function buildApi(rows: NoteRow[] = makeRows(["a.md", "b/c.md"])): FrontmatterEditorAPI {
  const scanner = {
    scan: () => ({ totalNotes: rows.length, notesWithFrontmatter: 0, properties: [] }),
    buildAllRows: () => rows,
  } as unknown as FrontmatterScanner;
  const bulk = {} as unknown as BulkActionService;
  const snapshots = {
    list: async () => [],
    get: async () => null,
  } as unknown as SnapshotService;
  return new FrontmatterEditorAPI({} as App, scanner, bulk, snapshots);
}

describe("Vault Operator plugin-as-skill discovery contract", () => {
  const api = buildApi();
  const expected = [...FrontmatterEditorAPI.PUBLIC_METHODS].sort();

  it("D1: prototype reflection (scanner) finds exactly the public methods", () => {
    const found = discoverViaPrototype(api);
    expect(found).toEqual(expected);
  });

  it("D1: prototype reflection never leaks the private selector helper", () => {
    const found = discoverViaPrototype(api);
    expect(found).not.toContain("_selectorToRows");
    expect(found).not.toContain("selectorToRows");
    expect(found).not.toContain("constructor");
  });

  it("D2: Object.keys reflection (live probe) finds the same public methods", () => {
    // Proves the constructor binds methods as own enumerable props so the
    // probe_plugin live-probe is not blind to a class-instance API.
    const found = discoverViaKeys(api as unknown as Record<string, unknown>);
    expect(found).toEqual(expected);
  });

  it("D3: no public method collides with Vault Operator BLOCKED_METHODS", () => {
    for (const name of FrontmatterEditorAPI.PUBLIC_METHODS) {
      expect(VAULT_OPERATOR_BLOCKED.has(name)).toBe(false);
    }
  });

  it("D4: every public method is callable and described in the catalog", () => {
    const holder = api as unknown as Record<string, unknown>;
    for (const name of FrontmatterEditorAPI.PUBLIC_METHODS) {
      expect(typeof holder[name]).toBe("function");
    }
    const catalog = api.describeActions();
    const catalogMethods = catalog.actions.map((a) => a.apiMethod).sort();
    // Every described action maps to a real function on the API.
    for (const m of catalog.actions.map((a) => a.apiMethod)) {
      expect(typeof holder[m]).toBe("function");
    }
    // Catalog covers exactly the public surface -- no gaps, no ghosts.
    expect(catalogMethods).toEqual(expected);
  });
});

describe("getMatchingPaths (agent-friendly selector preview)", () => {
  it("D5: returns count + plain paths for kind=all", async () => {
    const api = buildApi(makeRows(["a.md", "b/c.md", "d.md"]));
    const res = await api.getMatchingPaths({ kind: "all" });
    expect(res.count).toBe(3);
    expect(res.paths).toEqual(["a.md", "b/c.md", "d.md"]);
  });

  it("D5: filters to the requested paths for kind=paths", async () => {
    const api = buildApi(makeRows(["a.md", "b/c.md", "d.md"]));
    const select: NoteSelector = { kind: "paths", paths: ["b/c.md", "d.md"] };
    const res = await api.getMatchingPaths(select);
    expect(res.count).toBe(2);
    expect(res.paths.sort()).toEqual(["b/c.md", "d.md"]);
  });
});
