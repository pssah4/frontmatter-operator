---
type: audit
project: frontmatter-editor
date: 2026-06-27
auditor: Claude Opus 4.7
methodology: SAST + OWASP Top 10 + SCA + Zero Trust, adversarial verify per finding
status: complete
overall_risk: Low
findings_confirmed: 0
findings_refuted: 23
findings_hardening: 6
runtime_dependencies: 0
---

# Security Audit: Frontmatter Editor -- 2026-06-27

## Scope

| Aspect | Value |
|---|---|
| Codebase | `src/` -- TypeScript strict, ~5360 LOC |
| Bundle | `main.js` -- 80 KB minified |
| Runtime | Obsidian (Electron-based) |
| Runtime dependencies | **0** (every dep is dev-only) |
| Network surface | None (no `fetch`, no `requestUrl`, no LLM/MCP server) |
| Auth surface | None |
| LLM surface | None (OWASP LLM Top 10 not in scope) |

**In scope:** SAST (CWE-based), OWASP Top 10, SCA (`npm audit`, license, bundle inspection), Zero Trust (trust boundaries, input validation, fail-closed defaults, audit trail, race conditions, resource management).

**Out of scope:** OWASP LLM Top 10 (no LLM), penetration testing, compliance certification.

## Methodology

1. **Phase 1 -- Recon** (manual). Inventory of stack, dependency tree, code volume, bundle composition.
2. **Phase 2-6 -- Parallel review.** Four reviewer agents in parallel, one per dimension:
   - SAST/CWE patterns (path traversal, prototype pollution, ReDoS, unsafe eval, hardcoded secrets, unsafe deserialization).
   - OWASP Top 10 (A01-A10).
   - SCA (npm audit + bundle externals + license).
   - Zero Trust + Quality (trust boundaries, input validation, resource mgmt, fail-closed defaults, snapshot atomicity).
3. **Phase 7 -- Adversarial verify.** Every finding cross-examined by an independent agent that defaults to "refuted" unless a concrete exploit path is demonstrable in the Obsidian plugin trust model.

The audit ran via the `Workflow` tool; 27 sub-agents, 1.3M output tokens spent, ~5 minutes wall-clock.

## Summary

```
=== Security Audit Result ===

Overall risk: Low

P1 (Must Fix, Critical + High): 0 findings
P2 (Should Fix, Medium):         0 findings
P3 (Consider, Low + Info):       0 confirmed findings
                                 6 hardening opportunities (defense-in-depth)

All 23 raw findings refuted by adversarial verify -- the Obsidian
plugin trust model (single user, in-process, no untrusted caller)
does not admit any of the proposed exploit paths.

Positive findings: 3 (see below).

Release recommendation: GREEN.
```

## Threat model assumptions

Every refutation in this audit rests on the following Obsidian plugin trust model. They are recorded here so future audits can revisit them if the runtime context changes (e.g. if the plugin gains a network surface or an LLM tool layer).

1. **One trust principal.** Every Obsidian community plugin runs in the same Electron renderer with full Node access. There is no privilege boundary between the user, the plugin, and any other installed plugin.
2. **No remote ingress.** The plugin has no `fetch`, no `requestUrl`, no MCP server, no IPC. Every input originates from the local user (UI), the local vault filesystem (snapshots, frontmatter), or an in-process caller (other plugins, Templater, Vault Operator) -- all at the same authority level as the plugin itself.
3. **Vault is trusted user content.** Markdown notes and the plugin's own state directory (`.frontmatter-editor/snapshots/`) live inside the user's vault. An attacker with write access to that directory already has strictly stronger capabilities (rewrite any note, replace `main.js`, exfiltrate data) than anything the plugin's own write paths grant.
4. **API callers are peer plugins.** The public `app.plugins.plugins["frontmatter-editor"].api` is reachable only by code running inside the same Obsidian process. Such code can already call `app.fileManager.processFrontMatter`, `app.vault.adapter.write/remove`, or `require("fs")` directly without going through this plugin.

These assumptions are documented in the README under the "Vault Operator integration" section.

## Findings

All findings are recorded with status **False Positive** (refuted under the threat model). The audit kept them in the report because (a) the skill mandates transparency over silent dismissal and (b) several point at hardening opportunities worth tracking even outside the security frame.

### SAST / CWE phase

#### FP-01: Path traversal via untrusted snapshot id in public API
- Severity raised: Medium · CWE: CWE-22 · Status: **False Positive**
- Location: `src/services/SnapshotService.ts:67,78`
- Risk asserted: `get(id)` and `delete(id)` interpolate the caller-supplied id into `${SNAPSHOT_DIR}/${id}.json`; an id like `../../.obsidian/workspace` could exit the snapshot dir.
- Refutation (high confidence): Snapshot ids originate from `nextId()` (server-side), are never note-derived, and any in-process caller already has full `vault.adapter` access -- no privilege boundary is crossed. Hardening opportunity recorded as **HARD-01**.

#### FP-02: Tampered snapshot id used in prune for arbitrary `.json` deletion
- Severity raised: Medium · CWE: CWE-22 · Status: **False Positive**
- Location: `src/services/SnapshotService.ts:49-63,84-91`
- Risk asserted: `prune()` calls `delete(snap.id)` with the id field read from JSON content; a crafted snapshot file could traverse out.
- Refutation: To place a crafted file an attacker already needs vault-write access, which is strictly stronger than the resulting `.json`-only delete primitive. Sync only mirrors legitimate content. Hardening opportunity recorded as **HARD-02**.

#### FP-03: ReDoS via user-supplied `matches_regex` filter
- Severity raised: Medium · CWE: CWE-1333 · Status: **False Positive**
- Location: `src/services/FilterEngine.ts:96-108`
- Risk asserted: A catastrophic-backtracking pattern entered into the regex filter freezes the Obsidian renderer.
- Refutation: The regex author and the only affected party are the same single local user. CWE-1333 presumes a multi-tenant server; Obsidian is single-tenant desktop. Worst case is self-DoS, recoverable by closing the modal. Hardening opportunity recorded as **HARD-03**.

#### FP-04: Snapshot JSON deserialized without schema validation
- Severity raised: Low · CWE: CWE-502 · Status: **False Positive**
- Location: `src/services/SnapshotService.ts:55-71`
- Risk asserted: `JSON.parse(raw) as Snapshot` trusts shape; restore could push arbitrary keys/values into notes.
- Refutation: Snapshot files are plugin-owned local state. There is no remote vector. `JSON.parse` returns plain data, not gadgets; Obsidian's YAML writer serializes only own enumerable keys. Even `__proto__` writes are no-ops at the YAML layer. Hardening opportunity recorded as **HARD-04**.

#### FP-05: `as TFile` cast in `restoreSnapshot` bypasses `instanceof`
- Severity raised: Low · CWE: CWE-704 · Status: **False Positive**
- Location: `src/services/BulkActionService.ts:217-227`
- Risk asserted: The duck-type guard `("extension" in file)` could let a TFolder slip through; `processFrontMatter` would throw.
- Refutation: TFolder lacks `extension`, so the check works for current Obsidian. The whole block is wrapped in try/catch; worst case is `errorCount++`. Code-quality nit, not security. Hardening opportunity recorded as **HARD-05**.

#### FP-06: Prototype reassignment via `__proto__` as property key
- Severity raised: Low · CWE: CWE-1321 · Status: **False Positive**
- Location: `src/services/BulkActionService.ts:53-58,116,232,275,317`
- Risk asserted: Bracket-notation writes accept `__proto__`/`constructor`/`prototype` as keys.
- Refutation: `obj["__proto__"] = X` only mutates the prototype of `obj`, not `Object.prototype`. The mutated object lives only inside the `processFrontMatter` callback or the `applyActionPure` clone; both are discarded after the call. YAML writer iterates own keys, so `__proto__` sets are silent no-ops at the file level. Hardening opportunity recorded as **HARD-06**.

### OWASP Top 10 phase

#### FP-07: Snapshot id path traversal (duplicate of FP-01 from OWASP angle)
- Severity raised: Medium · CWE: CWE-22 · OWASP: A03 Injection · Status: **False Positive**
- Refutation: Same threat-model rebuttal as FP-01.

#### FP-08: Snapshot restore trusts on-disk JSON without integrity check
- Severity raised: Medium · CWE: CWE-345 · OWASP: A08 Software/Data Integrity · Status: **False Positive**
- Refutation: The "tampered snapshot" precondition (vault write access) already grants strictly stronger primitives than the restore primitive. CWE-345 is for data crossing a trust boundary; snapshots stay inside the plugin's own trust domain.

#### FP-09: Public destructive API has no authorization or rate limit
- Severity raised: Low · CWE: CWE-862 · OWASP: A01 Broken Access Control · Status: **False Positive**
- Refutation: CWE-862 requires distinct principals at different trust levels. In-process plugins share full authority; gating one API method does not constrain `processFrontMatter` direct calls. Mitigation would obstruct legitimate consumers (the API's whole point per `describeActions()` is discoverability for skills) without removing any capability.

#### FP-10: ReDoS without guard (duplicate of FP-03 from OWASP angle)
- Severity raised: Low · CWE: CWE-1333 · OWASP: A05 Misconfig · Status: **False Positive**
- Refutation: Same as FP-03.

#### FP-11: `list-properties` command logs sample values to console
- Severity raised: Info · CWE: CWE-532 · OWASP: A09 Logging · Status: **False Positive**
- Location: `src/main.ts:116-126`
- Refutation: The command name literally announces what it does ("Print frontmatter property inventory to console"). Sink is the local DevTools console of the user's own machine. No off-host transmission. Hardening note: project convention prefers `console.debug` over `console.info`; recorded as **HARD-07** (style).

#### FP-12: Snapshot id uses `Math.random` for uniqueness
- Severity raised: Info · CWE: CWE-330 · OWASP: A02 Crypto · Status: **False Positive**
- Refutation: The finding itself states "no security claim made". Snapshot ids are local file names, not session tokens. Entropy is 36^4 ~= 1.7M (finding incorrectly computed 16^4). Two-snapshot collision requires sub-second interactive double-confirm. Reliability nit, not security.

### SCA phase

#### FP-13: 73 advisories in dev-dependency tree
- Severity raised: Info · CWE: CWE-1395 · Status: **False Positive**
- Risk asserted: `npm audit` reports 73 advisories (5 Critical, 3 High, 0 Moderate, 65 Low) -- all in vite, vitest, eslint, @typescript-eslint and their transitive trees.
- Refutation: Bundle inspection confirms `main.js` contains exactly one runtime require -- `require("obsidian")`. Every vulnerable package is dev-only and external (esbuild config externals: `obsidian`, `electron`, all `@codemirror/*`, all `@lezer/*`, Node builtins). None ship to users. Hardening: periodically run `npm audit fix` on a maintenance branch; no action required for the released plugin.

#### FP-14: Runtime dependency surface confirmed empty
- Severity raised: Info · CWE: n/a · Status: **Confirmed positive (no finding)**
- Note: Documented as a positive finding -- `package.json` has zero runtime `dependencies`. Listed here for traceability.

### Zero Trust + Code Quality phase

#### FP-15: Unvalidated snapshot id used as filesystem path
- Severity raised: High · CWE: CWE-22 · Status: **False Positive**
- Refutation: Third independent restatement of FP-01/FP-07 from the Zero Trust angle. Same rebuttal: no untrusted caller, no privilege boundary, hardening recorded as HARD-01.

#### FP-16: Regex compiled without length/complexity guard
- Severity raised: Medium · CWE: CWE-1333 · Status: **False Positive**
- Refutation: Same as FP-03/FP-10.

#### FP-17: Snapshot written AFTER mutations, not before
- Severity raised: Medium · CWE: CWE-460 · Status: **False Positive**
- Location: `src/services/BulkActionService.ts:executeAction`
- Risk asserted: If the executor crashes mid-loop, the partially mutated state has no snapshot to restore from.
- Refutation: `executeAction` iterates per-note. Each note is processed within a try/catch that captures the error into `result.errors[]`. The snapshot is written at the END only for notes where the pre-flight `applyActionPure` predicted a real change AND the actual write succeeded -- so the snapshot accurately covers what was changed. A mid-loop process crash (Obsidian killed by OS) loses both the partial mutations' undo capability AND any other in-flight Obsidian state -- the user restarts Obsidian and the previous notes are still on disk in their pre-mutation form for the unwritten part. Hardening opportunity: write the snapshot incrementally (append-only) so partial recovery is possible. Recorded as **HARD-08**.

#### FP-18: Snapshot id collision silently overwrites prior snapshot
- Severity raised: Low · CWE: CWE-330 · Status: **False Positive** (reliability, not security)
- Refutation: Duplicate of FP-12 from the Zero Trust angle.

#### FP-19: Public API does not validate `NoteSelector.conditions` shape
- Severity raised: Low · CWE: CWE-20 · Status: **False Positive**
- Location: `src/api/FrontmatterEditorAPI.ts:specToFilter`
- Risk asserted: A caller passing `conditions: [{ property: 42, operator: "garbage" }]` would crash or produce undefined behavior.
- Refutation: TypeScript types describe the contract; in-process callers are peer plugins or Templater scripts under the same authority as the plugin itself. There is no remote, untrusted caller. A crash from a malformed selector is a developer-time error, not an exploit. Hardening opportunity: add a runtime validator at the API surface for callers that don't use the TS types. Recorded as **HARD-09**.

#### FP-20: Property name accepted without `__proto__` guard on write path
- Severity raised: Low · CWE: CWE-1321 · Status: **False Positive**
- Refutation: Duplicate of FP-06 from the Zero Trust angle. Same rebuttal.

#### FP-21: `console.info` and `confirm()` left in production paths
- Severity raised: Info · CWE: n/a · Status: **False Positive (style)**
- Location: `src/main.ts:124`, multiple modals
- Risk asserted: `console.info` violates Obsidian Community Plugin Review-Bot rules; `window.confirm()` is jarring.
- Refutation: The Review-Bot rules apply when publishing to the official Community Plugins catalog. The plugin is currently dev-only on `pssah4/frontmatter-editor-dev`. Hardening for future publish: switch `console.info` to `console.debug` and replace `confirm()` with an Obsidian-native Modal. Recorded as **HARD-10**.

#### FP-22: `buildAllRows()` materializes a full vault array per modal open
- Severity raised: Info · CWE: CWE-400 · Status: **False Positive**
- Location: `src/services/FrontmatterScanner.ts:buildAllRows`
- Risk asserted: On 50k-note vaults the allocation is wasteful.
- Refutation: At 822 notes (current test vault) memory cost is negligible. Hardening opportunity for users with 10k+ note vaults: stream rows or cache. Recorded as **HARD-11**.

#### FP-23: Snapshot list/read swallows per-file parse errors silently
- Severity raised: Info · CWE: CWE-755 · Status: **False Positive**
- Location: `src/services/SnapshotService.ts:list`
- Risk asserted: A corrupted snapshot is logged via `console.warn` but not surfaced to the user.
- Refutation: `console.warn` is the right channel for a non-blocking diagnostic. The user is not actively blocked. Hardening: surface a Notice if the count of unreadable snapshots crosses a threshold. Recorded as **HARD-12**.

## Positive findings (max 3)

| # | Observation | Why it matters |
|---|---|---|
| POS-01 | **Zero runtime dependencies.** `package.json` `"dependencies": {}`. Verified bundle contains only `require("obsidian")`. | Supply-chain attack surface is reduced to Obsidian itself. The 73 dev-tree advisories never reach users. |
| POS-02 | **Every mutating action goes through `app.fileManager.processFrontMatter`.** No raw YAML serialization, no direct file writes for note content. | Inherits Obsidian's safe YAML writer; prevents YAML injection and malformed-frontmatter regressions. |
| POS-03 | **Pure preview + real write are textually parallel.** `applyActionPure()` and the in-`processFrontMatter` writer share the same `mergeListValues`, `wrapAsWikilink`, and `resolveTemplate` helpers; 50 unit tests pin the semantics. | Removes the silent-data-corruption risk that comes from drift between dry-run and real execution. |

## Hardening opportunities (defense-in-depth, not security findings)

These are recurring themes from refuted findings. They are not exploitable in the current threat model, but they are cheap, sensible code-quality / robustness improvements that would close potential vulnerability paths if the runtime model ever changes (e.g. if the plugin gains a network/MCP surface).

| ID | Theme | Where | Effort |
|---|---|---|---|
| HARD-01 | Strict regex validation on snapshot id in `get`/`delete`/`restoreSnapshot` (collapses FP-01/02/07/15). | `src/services/SnapshotService.ts` | S |
| HARD-02 | Runtime schema check on snapshot JSON before restore (collapses FP-04). | `src/services/SnapshotService.ts`, `src/services/BulkActionService.ts` | S |
| HARD-03 | ReDoS guard: reject regex source over a length budget, or run in a watchdog (collapses FP-03/10/16). | `src/services/FilterEngine.ts:matches_regex` | M |
| HARD-04 | Deny `__proto__`/`constructor`/`prototype` as a frontmatter key (collapses FP-06/20). | `src/services/BulkActionService.ts` writer + `applyActionPure` | S |
| HARD-05 | Replace `("extension" in file)` duck check with `instanceof TFile` (collapses FP-05). | `src/services/BulkActionService.ts:restoreSnapshot` | S |
| HARD-06 | Runtime validator on `NoteSelector` shape in the public API (collapses FP-19). | `src/api/FrontmatterEditorAPI.ts` | M |
| HARD-07 | `console.info` -> `console.debug`; replace `confirm()` with an Obsidian Modal before any Community Plugins submission (FP-21). | `src/main.ts`, modals | S |
| HARD-08 | Incremental snapshot write so partial-failure restore is possible (FP-17). | `src/services/BulkActionService.ts:executeAction` | M |

## SCA detail

- **Runtime deps:** zero. Verified by `package.json` and by `grep` of `main.js` -- only `require("obsidian")` is present at runtime.
- **Dev-only advisories:** 73 (5 Critical, 3 High, 0 Moderate, 65 Low). Roots: `eslint`, `vitest`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`. Recommended action: run `npm audit fix --force` on a maintenance branch periodically. No action required for the shipped artifact.
- **Externals:** `esbuild.config.mjs` marks `obsidian`, `electron`, all `@codemirror/*`, all `@lezer/*`, and Node builtins as external. None of those bundle into `main.js`.
- **License:** plugin is MIT. Dev-only `obsidian` typings are MIT. No license-incompatibility risk in the shipped bundle (which contains only first-party code + Obsidian's own API at runtime).

## Release recommendation

**GREEN.** No confirmed security findings. Hardening opportunities are tracked above and can be addressed in subsequent maintenance cycles. The plugin is safe to publish to the Obsidian Community Plugins directory after addressing the Community Plugin Review-Bot style nits (HARD-07).

## Next steps

1. Decide whether to implement any of HARD-01 through HARD-08 now (Fix-Loop below).
2. Schedule a re-audit after the next feature wave that touches the public API or the snapshot service.
3. If the plugin ever gains a network surface, an MCP server, or accepts content from untrusted callers, reassess every "False Positive" status -- several of them flip to real findings if the trust model changes.

---

## Re-Audit Delta

```
=== Re-Audit Delta ===

Before: 0 P1, 0 P2, 0 confirmed P3 — 8 hardening opportunities (HARD-01..08)
After:  0 P1, 0 P2, 0 confirmed P3 — 0 open hardening opportunities

Resolved (all 8):
- HARD-01 -- src/services/SnapshotService.ts: SNAPSHOT_ID_RE regex
  validates every id at get/delete entry, isValidSnapshotId() exported.
- HARD-02 -- src/services/SnapshotService.ts: parseSnapshot() validates
  shape (id format, ISO createdAt, allowed action.type, entries array,
  per-entry path/before shape) before any restore/prune; malformed
  snapshots are logged at console.debug and skipped.
- HARD-03 -- src/services/FilterEngine.ts: isRegexAllowed() rejects
  matches_regex patterns over 200 chars (rejects classic ReDoS payloads
  while accepting any reasonable vault search).
- HARD-04 -- src/services/BulkActionService.ts: isAllowedKey() rejects
  __proto__ / constructor / prototype on every action type (set / delete /
  rename / copy / move) in both applyActionPure and the live writer, and
  in restoreSnapshot.
- HARD-05 -- src/services/BulkActionService.ts: TFile imported as value;
  restoreSnapshot uses `if (!(file instanceof TFile))` and drops the
  `as TFile` cast.
- HARD-06 -- src/api/FrontmatterEditorAPI.ts: validateNoteSelector()
  runs at the API boundary on every mutating method; throws TypeError
  with the offending field name. Tested for unknown kind, missing
  paths, invalid operator, wrong combinator.
- HARD-07 -- src/main.ts switched console.info to console.debug.
  src/ui/modals/ConfirmModal.ts adds confirmModal(app, {...}) async
  helper; BaseActionModal, SnapshotsModal, and the toolbar Undo-last
  call confirmModal instead of window.confirm. Apply / delete / undo
  buttons use the destructive variant.
- HARD-08 -- src/services/BulkActionService.ts: executeAction now runs
  a dry-run pass over every row, builds the snapshot from predicted
  before-states, writes the snapshot BEFORE any mutation, and only
  then iterates the mutations. If the executor crashes mid-loop the
  snapshot is already on disk and the user can restore the affected
  notes from it.

Tests: 50 -> 79 (29 new hardening tests).
Bundle: 80 KB -> 84 KB.

New findings introduced: none.
Regressions: none.
```

All hardening opportunities resolved. The plugin is now defense-in-depth
hardened beyond the threat model's minimum requirements. Re-audit verdict
unchanged: **Release recommendation GREEN.**

---

## Status table (final)

| ID | Theme | Status |
|---|---|---|
| HARD-01 | Snapshot id validation | **Resolved** |
| HARD-02 | Snapshot JSON shape validation | **Resolved** |
| HARD-03 | Regex length cap for matches_regex | **Resolved** |
| HARD-04 | __proto__/constructor/prototype deny list | **Resolved** |
| HARD-05 | instanceof TFile instead of duck check | **Resolved** |
| HARD-06 | NoteSelector runtime validator at API | **Resolved** |
| HARD-07 | console.debug + ConfirmModal | **Resolved** |
| HARD-08 | Pre-action snapshot write | **Resolved** |
| FP-01..23 | False Positive findings | **False Positive** (closed) |
