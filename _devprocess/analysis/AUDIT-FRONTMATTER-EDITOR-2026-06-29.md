---
type: audit
project: frontmatter-editor
date: 2026-06-29
auditor: Claude Opus 4.7
methodology: SAST + OWASP Top 10 + OWASP LLM Top 10 + SCA + Zero Trust, adversarial verify per finding
status: complete
overall_risk: High
findings_confirmed: 16
findings_refuted: 23
findings_hardening: 14
runtime_dependencies: 3
---

# Security Audit: Frontmatter Editor -- 2026-06-29

## Scope

| Aspect | Value |
|---|---|
| Codebase | `src/` -- TypeScript strict, 16,527 LOC total (13,738 non-test) across 66 .ts files |
| Bundle | `main.js` -- 612,238 bytes (~598 KB minified), grew 7.6x from 80 KB |
| Runtime | Obsidian (Electron-based), `minAppVersion 1.5.0`, `isDesktopOnly false` |
| Runtime dependencies | **3** (`@aws-sdk/client-bedrock`, `@aws-sdk/client-bedrock-runtime`, `@smithy/node-http-handler`) |
| Network surface | ~16 external hosts (Anthropic, OpenAI, OpenRouter, Gemini, GitHub Copilot proxy, AWS Bedrock, chatgpt.com, auth.openai.com, github.com OAuth, api.kilo.ai, Ollama/LM Studio loopback) |
| Auth surface | 3 OAuth flows (GitHub Copilot Device, ChatGPT PKCE, Kilo device-auth) + 4 API-key/bearer modes + 1 local loopback callback (port 1455-1460 fallback) |
| LLM surface | 5 provider classes, 12 ProviderType variants, prompt templates in 11 languages, user-editable prompts persisted to data.json, vault-content prompt interpolation, snapshot-undoable LLM-driven writes |

**In scope:** SAST (CWE-based), OWASP Top 10, OWASP LLM Top 10, SCA (`npm audit --omit=dev`, license, bundle inspection), Zero Trust (trust boundaries, input validation, fail-closed defaults, audit trail, race conditions, resource management), OAuth/PKCE compliance (RFC 6749, RFC 7636, RFC 8252), plaintext-secret persistence regression review, impersonation-header TOS/maintenance risk.

**Out of scope:** AWS SigV4 implementation correctness (delegated to AWS SDK), penetration testing, compliance certification, dev-only dependency advisories not reachable from the shipped bundle.

## Methodology

1. **Phase 1 -- Recon.** Inventory of stack, dependency tree, code volume, bundle composition, network/auth/LLM/storage surface. Diff against the 2026-06-27 audit baseline (24 commits since).
2. **Phase 2-6 -- Parallel review.** Five reviewer dimensions in parallel: SAST/CWE patterns, OWASP Top 10, OWASP LLM Top 10, SCA, Zero Trust + Quality.
3. **Phase 7 -- Adversarial verify.** Every finding cross-examined by an independent agent that defaults to "refuted" unless a concrete exploit path is demonstrable. Each finding tagged Confirmed / Mitigated / Severity-Downgrade / False-Positive with reasoning.
4. **Phase 8 -- Deduplication + synthesis.** Cross-dimension duplicates collapsed (SafeStorage dead-code appeared in two dimensions; snapshot-in-vault in three; impersonation in two; OpenRouter Referer in three).

## Summary

```
=== Security Audit Result ===

Overall risk: High

P1 (Must Fix, Critical + High): 2 findings
P2 (Should Fix, Medium):         2 findings
P3 (Consider, Low + Info):       12 findings (8 Low + 4 Info)

Adversarial refuted: 23 raw findings (mostly hallucinated file paths,
already-mitigated guards from AUDIT-037/038, or fixed-port claims that
ignored the actual fallback range in PkceLoopbackServer.ts).

Already-mitigated guards confirmed by adversarial verify:
- src/api/providers/providerUrlGuard.ts blocks IMDS / private IP /
  loopback for every cloud provider; Bedrock pinned to *.amazonaws.com;
  HTTPS required for openai/anthropic/openrouter/azure/gemini/copilot/
  chatgpt-oauth/kilo-gateway (AUDIT-037 H-1/H-2, AUDIT-038 ISSUE-002).
- ChatGPT PKCE state parameter IS validated end-to-end (constant-time-
  irrelevant string compare on a 32-byte random; CSRF defence intact).
- Loopback port 1455 is NOT hard-coded -- PkceLoopbackServer.ts iterates
  [1455..1460] with EADDRINUSE fallback.

Release recommendation: AMBER. Two High findings (H-1, H-5) must land
before public-release; both are mechanical fixes in already-isolated
modules.
```

## Threat model assumptions (revised from 2026-06-27)

The 2026-06-27 audit operated under a "single trust principal, no network, no LLM, no auth" model and refuted every raw finding on that basis. Of those four assumptions, **only the single-trust-principal assumption still holds**. The other three have been invalidated by the LLM integration wave:

1. **One trust principal -- still valid.** Every Obsidian community plugin still runs in the same Electron renderer with full Node access. No privilege boundary between user, plugin, and other plugins.
2. **No remote ingress -- still valid for inbound.** The loopback OAuth callback server binds 127.0.0.1 only, is single-shot, and validates `state`. No other inbound surface.
3. **No remote egress -- NOW INVALID.** The plugin now talks to 16 external hosts including AWS Bedrock, OpenAI, Anthropic, OpenRouter, Gemini, GitHub, GitHub Copilot proxy, and chatgpt.com. Two paths (`ChatGptResponsesProvider`, `PkceLoopbackServer`) bypass Obsidian's `requestUrl` via raw Node `https`/`http` modules.
4. **No persisted secrets -- NOW INVALID.** Long-lived OAuth refresh tokens, AWS access+secret keys, Bedrock bearers, gateway subscription headers, and per-provider API keys are persisted in `data.json` as plaintext (see H-1).
5. **No LLM -- NOW INVALID.** OWASP LLM Top 10 is in scope. Vault note bodies feed prompts; LLM output is parsed and written back to frontmatter.

These assumption deltas drive the audit's High verdict.

## Findings

Findings are deduplicated across dimensions and grouped by final severity after adversarial verify.

### P1 -- High severity (must fix before public release)

#### H-1: OAuth tokens, refresh tokens, and AWS credentials persisted as plaintext (SafeStorageService is dead code)

- Severity: **High** -- CWE-312 (Cleartext Storage), CWE-522 (Insufficiently Protected Credentials) -- OWASP A02:2021 Cryptographic Failures
- Location: `src/main.ts:56`, `src/auth/SafeStorageService.ts:35-78`, `src/auth/ChatGptOAuthService.ts:196-226`, `src/auth/GitHubCopilotAuthService.ts:172-213`, `src/auth/KiloAuthService.ts:51-69`, `src/types/settings.ts:23`
- Risk: Every long-lived credential the plugin touches lands in `.obsidian/plugins/frontmatter-editor/data.json` as cleartext. That includes the GitHub OAuth access token with scope `read:user copilot`, the short-lived Copilot bearer, the **long-lived ChatGPT OAuth refresh token** (re-issuable PKCE token), the ChatGPT `id_token` + account-id + email, the Kilo long-lived API token, AWS access key + secret key + session token, the Bedrock api-key bearer, and the gateway subscription header value. `SafeStorageService` is instantiated in `main.ts:56` and exposes a working `encrypt() / decrypt()` pair with an `enc:v1:<base64>` envelope, but a project-wide grep confirms **zero callers outside the module itself**. Every `saveSettings()` path writes raw strings. The README and the `chatgptOAuthAccessToken` comment at `src/types/settings.ts:23` advertise SafeStorage protection -- this is a documented-contract regression.
- Exposure paths: disk-level theft of `data.json`, accidental commit to a vault git repo, Obsidian Sync mishap, iCloud/Dropbox replication of `.obsidian/`, a second malicious plugin reading the file. The GitHub Copilot OAuth scope (`read:user copilot`) lets an attacker drive billed Copilot completions and read profile data; the ChatGPT refresh token is long-lived; AWS access+secret pairs unlock the full Bedrock account.
- Adversarial verification (Confirmed): grep across `src/` returned no `.encrypt(` or `.decrypt(` call sites outside `SafeStorageService.ts`. `loadSettings()` simply spreads `loadData()` into `this.settings`; `saveSettings()` does a bare `saveData(this.settings)`. The `persist()` paths in `ChatGptOAuthService.ts:196-226` write raw `access_token`, `refresh_token`, and `id_token`.
- Remediation: Wire `plugin.safeStorage.encrypt(...)` around every sensitive field on every save and `decrypt(...)` on every load. In `loadSettings()` post-process the loaded object to decrypt the seven OAuth/token fields + AWS secret/session fields + every `providers[*].apiKey / awsApiKey / awsAccessKey / awsSecretKey / awsSessionToken / gatewayHeaderValue`. In `saveSettings()` pre-process by encrypting the same fields. Persist the `enc:v1:` prefix so reads can detect already-encrypted values. For `safeStorage.isAvailable() === false`, fire `notifyPlaintextFallbackOnce` and keep a visible Settings banner. Add a regression test that asserts a saved settings file contains no raw bearer/key-shaped substring. Effort: **M**.

#### H-5: SnapshotService.parseSnapshot whitelist missing 'transfer' action -- BulkAction transfer snapshots un-restorable across restarts

- Severity: **High** -- CWE-754 (Improper Check) / CWE-573 (Spec Adherence)
- Location: `src/services/SnapshotService.ts:26-35`, `src/services/BulkActionService.ts:99-167`, `src/types.ts:56-63`
- Risk: `BulkActionService` supports five action types `set | delete | rename | copy | move | transfer`. The 'transfer' type is first-class (case at `BulkActionService.ts:102`, transfer-specific branches at 123-127, 158-161, 355-358, 383-386). `executeAction` writes the snapshot via `snapshots.save({action, entries})` with `action.type === 'transfer'`. But `parseSnapshot()` only whitelists `set / delete / rename / copy / move` and returns `null` for anything else. Next time `SnapshotsModal` lists snapshots OR `api.undoLast()` iterates `list()`, every transfer snapshot is silently filtered (console.debug only). The user sees Undo work **in-session** (the snapshot object is still in memory) but discovers the snapshot is gone after a reload -- defeating the safety net for the primary new action type.
- Adversarial verification (Confirmed): `parseSnapshot` at `SnapshotService.ts:27-35` literally whitelists five strings; `types.ts:56-63` declares `BULK_ACTION_TYPES` to include `'transfer'` with the explicit comment "new writes emit 'transfer'". No fallback recovery path, no reachability gate.
- Remediation: Add `'transfer'` to the parseSnapshot action.type whitelist. Better: derive the whitelist from a single union literal exported from `src/types.ts` so the next added action type cannot drift again. Add a vitest covering "save -> list round-trip preserves all action types declared in `BULK_ACTION_TYPES`". Effort: **S**.

### P2 -- Medium severity

#### M-2: Gemini API key transmitted as URL query parameter -- logged in proxy/server access logs

- Severity: **Medium** -- CWE-598 (Exposure via Query String)
- Location: `src/api/fetchModels.ts:178`, `src/api/providers/GeminiProvider.ts:28`
- Risk: Both the inference call (`generateContent?key=${apiKey}`) and the model discovery call (`/v1beta/models?key=${apiKey}&pageSize=200`) place the Gemini API key in the query string. URL query strings appear in Google's server access logs (documented behaviour), any forward/corporate HTTP proxy that logs full request URLs, and any stack-trace path that echoes the URL. TLS protects in-transit, but the leak vectors that remain are concrete. Google's v1beta endpoint accepts `x-goog-api-key` as a header alternative.
- Adversarial verification (Confirmed): Both code locations match the finding verbatim. A second occurrence at `GeminiProvider.ts:28` for `generateContent` should be fixed alongside the discovery call.
- Remediation: Switch both call sites to GET with `headers: { 'x-goog-api-key': apiKey, Accept: 'application/json' }`. Drop the `?key=` query parameter. Verify no error path echoes the URL into a `Notice`. Effort: **S**.

#### M-7: Snapshot directory inside the vault leaks pre-mutation frontmatter to cloud sync

- Severity: **Medium** -- CWE-538 (Information Exposure Through Files) / CWE-552
- Location: `src/services/SnapshotService.ts:4`, `src/services/RefusalTagCleanupService.ts:176-184`, `src/services/BulkActionService.ts:213-254`
- Risk: `SNAPSHOT_DIR = ".frontmatter-editor/snapshots"` is a vault-relative path. Every bulk action + generator run + refusal cleanup writes a JSON file containing the `before` frontmatter of every touched note. For RefusalTagCleanupService specifically, the entire affected frontmatter (the content the user wanted **removed**) is duplicated. Obsidian Sync respects hidden dot-folders by default; iCloud Drive, Dropbox, OneDrive, Google Drive, Syncthing, and Git do not. Result: every prior frontmatter value the user ever rolled back is mirrored to the sync target, durably, across all synced devices.
- Adversarial verification (Confirmed): No upstream guard exists; `pathFor()` simply concatenates SNAPSHOT_DIR with the id, and `save()` persists `payload.entries` verbatim via `vault.adapter.write`. README even instructs users that snapshots live there.
- Remediation: Move snapshots under `${vault.configDir}/plugins/frontmatter-editor/snapshots/` so they live alongside `data.json` and inherit Obsidian's existing plugin-data exclusion. Migrate existing snapshots once on plugin load and delete the vault-side directory. Add a unit test that the path no longer references vault root. Effort: **M**.

### P3 -- Low severity (defence-in-depth + UX)

#### L-1 (LLM): Vault note bodies spliced verbatim into LLM prompts -- no defence-in-depth wrap

- Severity: Low -- OWASP LLM01 Prompt Injection -- Location: `src/services/generator/GeneratorService.ts:135-150, 196-223`.
- Note body interpolated at `{{NOTE_BODY}}` (truncated to 12 000 chars) with no untrusted-input delimiter. A note containing prompt-injection payloads can steer the model to return attacker-influenced frontmatter values. Bounded: output goes through `parseResponse()` to a typed value, then `processFrontMatter` -- no code execution, no path traversal. Low because the user is feeding their own vault.
- Remediation: wrap in `<note_body_untrusted>...</note_body_untrusted>`; reject `:` / `/` / `\` in keyword items; strip control chars from descriptions; document the threat in Settings. Effort: **S**.

#### L-2 (LLM): RefusalTagCleanupService aggressive substring matcher

- Severity: Low -- CWE-697 -- Location: `src/services/RefusalTagCleanupService.ts:97-152`, `src/services/generator/GeneratorService.ts:543-559`.
- `KNOWN_REFUSAL_SUBSTRINGS` includes generic phrases (`cannot generate`, `unable to generate`, `the note appears to be empty`, German equivalents). Scan covers every non-reserved frontmatter key on every markdown file. Confirm dialog only shows aggregate counts, not the actual values being removed. A legitimate note value containing the substring is silently stripped. Snapshot covers the batch, but H-5 means transfer snapshots disappear across restarts; refusal cleanup uses its own action type, but the broader pattern of "trust the snapshot" warrants tightening.
- Remediation: Narrow default scope to known generator-target properties (`description`, `keywords`, `aliases`, `topics`, `concepts`); require >=2 known-refusal triggers OR a structural keyword check; surface per-value diff in the confirm dialog. Effort: **M**.

#### L-1 (SCA): AWS SDK + Smithy runtime deps caret-pinned (silent minor/patch drift)

- Severity: Low -- CWE-1357 / CWE-829 -- Location: `package.json:34-36`.
- All three runtime deps use caret ranges; AWS SDK publishes daily. Lockfile is committed (good), but a fresh checkout running `npm install` (not `npm ci`) could pick up an unaudited patch.
- Remediation: Tighten to tilde, OR document `npm ci` as the canonical install command, OR add Renovate/Dependabot so AWS bumps land deliberately. Effort: **S**.

#### L-2 (SCA): 65 low-severity advisories across @typescript-eslint chain

- Severity: Low -- transitive via `debug` / `minimatch` -- Location: `package.json:25-26`.
- `fixAvailable: false` on every entry. Dev-time tooling only; never reaches `main.js`. `npm audit`'s auto-suggested downgrade to v5.62.0 would lose 3 years of rule improvements and must not be accepted.
- Remediation: Upgrade `@typescript-eslint/*` in lockstep with any future eslint major bump. Effort: **S**.

#### L-2 (SAST): OpenRouter HTTP-Referer leaks dev-repo URL

- Severity: Low -- CWE-200 -- Location: `src/api/providers/OpenAICompatibleProvider.ts:102-107`, `src/api/fetchModels.ts:84-88`.
- Every OpenRouter chat completion and model-list call hard-codes `HTTP-Referer: https://github.com/pssah4/frontmatter-editor-dev` and `X-Title: Frontmatter Editor`. The value is the dev fork URL, not the published plugin URL. Leaked content is the plugin's own identity (not user PII), but the `-dev` suffix is a branding bug.
- Remediation: Point to the canonical published repo, or drop the headers, or make them opt-in via a Settings toggle. Effort: **S**.

#### L-4 (SAST): Bedrock + Anthropic gateway header name/value injection (defence-in-depth)

- Severity: Low -- CWE-20 (Improper Input Validation) -- Location: `src/api/providers/BedrockProvider.ts:37-49,137-160`, `src/api/providers/AnthropicProvider.ts:64-66`.
- `gatewayHeaderName` and `gatewayHeaderValue` come from settings without RFC 7230 token validation. The Node `http` stack catches CRLF and throws `ERR_INVALID_CHAR`, so wire-level header smuggling is structurally blocked. Residual risks: a user-typed `Host` / `Content-Length` would overwrite SDK-mandated routing headers; malformed input produces a low-level TypeError instead of a friendly settings-time error.
- Remediation: Validate `gatewayHeaderName` against `^[A-Za-z0-9!#$%&'*+\-.^_\`|~]+$` and `gatewayHeaderValue` against printable ASCII no-CRLF at save-time in `ProviderDetailModal` AND at read-time before the provider edge. Blocklist `host / content-length / authorization / transfer-encoding`. Effort: **S**.

#### L-1 (Zero Trust): ChatGptResponsesProvider bypasses requestUrl via raw Node https

- Severity: Low -- CWE-829 -- Location: `src/api/providers/ChatGptResponsesProvider.ts:194-247`.
- The Codex backend gates on Origin/UA and Obsidian's `requestUrl` cannot stream SSE, so the bypass is justified, but no `Platform.isMobile` gate exists. On mobile Obsidian `window.require('https')` throws `require is not a function`, which surfaces as a confusing crash rather than a clean "desktop-only" error.
- Remediation: Add `Platform.isMobile` gate in `ProviderRegistry`; surface a clean "ChatGPT OAuth requires desktop Obsidian" error; document desktop-only in README. Effort: **S**.

#### L-3 (Zero Trust): BulkActionService snapshot race -- stale `before` on concurrent edit

- Severity: Low -- CWE-362 -- Location: `src/services/BulkActionService.ts:213-254`.
- `executeAction` builds the snapshot by cloning `row.frontmatter` (captured at scan time) and then issues per-file `writeFrontmatter` calls. A concurrent writer between scan and write can have its change silently overwritten on undo. Single-user blast radius; processFrontMatter serialises the write itself.
- Remediation: Re-read current frontmatter via `metadataCache.getFileCache(file)` before each `processFrontMatter`; if it differs from snapshot's `before`, skip + count as `racedSkipped`. Effort: **M**.

#### L (impersonation): Hard-coded VS Code Copilot + Codex CLI client ids and impersonation header bundles

- Severity: Low -- CWE-1357 (Reliance on Insufficiently Trustworthy Component) / OWASP A08 -- Location: `src/auth/GitHubCopilotAuthService.ts:19,223-230`, `src/auth/ChatGptOAuthService.ts:20`, `src/api/providers/ChatGptResponsesProvider.ts:27-43`, `src/api/fetchModels.ts:320-327`.
- VS Code Copilot public client id `Iv1.b507a08c87ecfe98` + six-header impersonation bundle (User-Agent `GitHubCopilotChat/0.39.2`, Editor-Version `vscode/1.111.0`, etc.). Codex CLI client id `app_EMoamEEZ73f0CkXaXp7hrann` + User-Agent `codex_cli_rs/0.140.0`. Backend gates the model list on the version string -- a stale version is silently served the old model set and every current model 400s. Acknowledged in code comments as load-bearing.
- Remediation: Surface impersonated version strings in the provider modal so support reports include the rejected values; detect HTTP 400 with `not supported` and suggest a plugin update; pull version constants into one config so a backend roll is a one-line change. For public-marketplace release, document the impersonation in README + Settings panel with an explicit `I understand this uses private APIs` opt-in. Effort: **S**.

#### L (UX): Generator vault-wide runs are uncancellable

- Severity: Low -- CWE-400 / CWE-754 -- Location: `src/services/generator/GeneratorService.ts:40-86, 95-279`.
- `GeneratorRunOptions` defines no `abortSignal`. A wrong-preset 1000-note run cannot be stopped without reloading the plugin. UX defect with token-cost implications, not a security finding in a single-user context.
- Remediation: Add `abortSignal?: AbortSignal` to `GeneratorRunOptions`; check `signal.aborted` at the top of each loop iteration; thread through `req.abortSignal` for SDK paths that support it; render a Cancel-during-run button in `GenerateActionModal`. Effort: **S**.

#### L (Kilo UX): Manual-token mode has no Settings affordance for `lastValidatedAt` or rotation prompt

- Severity: Low -- depends on H-1 for at-rest protection -- Location: `src/auth/KiloAuthService.ts validateAndSetManualToken`.
- Token IS validated against `/profile` before persisting, and `lastValidatedAt` IS recorded in the session model. UI just does not surface it.
- Remediation: Surface `lastValidatedAt` in the provider modal; add a "Rotate" hint after 90 days; explicit "Forget token" button (the `disconnect()` method already exists). Effort: **S**.

### P3 -- Info (positive observations + diagnostics)

#### I (SCA): AWS SDK subtree has zero advisories

- `npm audit --omit=dev` filtered for `aws-sdk|smithy` returns zero info/low/moderate/high/critical for the three new direct deps and their transitive Smithy tree. The pre-existing pptxgenjs/express-rate-limit advisories in the larger production tree are tracked elsewhere and are not in this audit's scope.

#### I (Vault write boundary): No path-string write from LLM output, no innerHTML/eval

- Every vault mutation routes through `app.fileManager.processFrontMatter(file, fn)` where `file` is a `TFile` from `metadataCache`. `parseResponse()` ensures LLM output is typed before merge. A repo-wide grep finds zero `innerHTML / setHTML / document.write / insertAdjacentHTML / eval / new Function` sinks in `src/`. The only `adapter.write` call is the snapshot JSON writer at `SnapshotService.ts:85` with a plugin-generated id. Prompt injection (L-1 LLM) can corrupt a value on the source note, but cannot escape that file or execute code.

#### I (Logging audit): No secrets leak via console

- Adversarial grep confirms no token / api-key / canonical-request / Authorization header is logged. `console.debug` calls in `main.ts:160, 197-200, 222-225` dump cleanup dry-run / write reports including frontmatter values, but the output goes to hidden DevTools and is intentional for user-invoked diagnostics behind a confirm dialog. Document in README that "developer console may contain frontmatter values during a cleanup run".

#### I (Already-mitigated guards confirmed)

Multiple raw findings turned out to be already-mitigated by existing guards introduced in AUDIT-037 H-1/H-2 and AUDIT-038 ISSUE-002. These deserve explicit positive callouts because the guards survive adversarial review:

- `src/api/providers/providerUrlGuard.ts` enforces HTTPS for cloud providers, blocks IMDS (`169.254.169.254` + IPv6 `fd00:ec2::254`), Azure/GCP metadata, `0.0.0.0`, and full private/loopback/link-local/CGNAT ranges for every cloud provider. Bedrock pinned to `^bedrock(-runtime)?\.[a-z0-9-]+\.amazonaws\.com$`. Wired into `anthropic.ts:91-93`, `openai.ts:213`, `bedrock.ts:162` constructors -- fail-closed before any SDK client is built.
- `ChatGptOAuthService.startAuthFlow` generates a 32-byte random `state`, passes it as `expectedState` to `PkceLoopbackServer`, and the loopback server rejects callbacks with mismatched state with HTTP 400 + `OAuth state mismatch`. CSRF / authorization-code-injection vector is closed end-to-end.
- `PkceLoopbackServer` is NOT pinned to port 1455; it iterates `[1455..1460]` with `EADDRINUSE` fallback and builds the redirect URI dynamically from the actually-bound port.
- `GitHubCopilotAuthService.getCopilotToken` caches `refreshPromise` so concurrent callers await a single in-flight refresh; the same pattern at `ChatGptOAuthService` `refreshAccessToken`. No saveSettings race.
- `@aws-sdk/client-bedrock` is in `dependencies` (not unused) -- consumed via dynamic `await import(...)` in `src/ui/settings/testModelConnection.ts:688` for the "Fetch Models" UI's `ListFoundationModelsCommand` + `ListInferenceProfilesCommand`. The author's comment explains the lazy-import keeps the control-plane SDK out of the hot path.

## Comparison with 2026-06-27 audit

The 2026-06-27 baseline rated the project **GREEN** under a "zero runtime deps, no network, no LLM, no auth" model. Every assumption in that model except "single trust principal" has been invalidated by 24 commits over two days.

| Dimension | 2026-06-27 | 2026-06-29 | Delta |
|---|---|---|---|
| Runtime deps | 0 | 3 (AWS SDK Bedrock + Bedrock-Runtime + Smithy node-http-handler) | +3 |
| Bundle size | 80 KB | 612 KB | 7.6x |
| Source LOC | ~5,360 | 13,738 non-test | +156% |
| Network egress | none | ~16 external hosts | new |
| Auth surface | none | 3 OAuth flows + 4 API-key modes + loopback callback | new |
| LLM surface | none | 5 providers, 12 ProviderTypes, 11 languages | new |
| OAuth/PKCE in scope | no | yes (RFC 6749, 7636, 8252) | new |
| OWASP LLM Top 10 in scope | no | yes | new |
| Persisted secrets | none | 13+ token/key fields in data.json | new |
| Vault-resident plugin state | none | `.frontmatter-editor/snapshots/` | new |
| `confirmed` security findings | 0 | 16 (2 High, 2 Medium, 12 Low/Info) | +16 |
| `refuted` findings | 23 | 23 | parity |
| Overall risk | Low (GREEN) | High (AMBER) | regression |

Categories newly assessed: **OWASP LLM Top 10** (prompt injection, refusal-handling false positives, LLM-driven vault mutations), **OAuth/PKCE compliance** (state validation, loopback port hygiene, PKCE verifier handling), **AWS SDK SCA** (transitive Smithy tree), **persisted-secret encryption** (SafeStorage wrapper review), **impersonation TOS** (client-id + User-Agent + Editor-Version impersonation of first-party clients).

The good news: the 2026-06-27 hardening pass (HARD-01..08) is still in force -- `SNAPSHOT_ID_RE`, `parseSnapshot()` schema validation, `isAllowedKey()` for `__proto__/constructor/prototype`, `instanceof TFile`, `validateNoteSelector()`, `confirmModal` Obsidian-native dialog, and pre-action snapshot write all survive in the current code.

## Remediation plan

P1 + P2 sized for the next sprint. All effort estimates assume a single engineer familiar with the codebase.

| ID | Title | Effort | Notes |
|---|---|---|---|
| H-1 | Wire SafeStorageService into save/load for all secret fields | **M** | Mechanical wrap of `loadSettings()` and `saveSettings()`; persist `enc:v1:` prefix; add migration for existing plaintext `data.json`; regression test asserts no bearer-shaped substring survives a save round-trip. Mirror VO's `encryptSettingsForSave` pattern. |
| H-5 | Add 'transfer' to `parseSnapshot` action.type whitelist | **S** | Derive whitelist from `BULK_ACTION_TYPES` union to prevent future drift; round-trip test for every action type. |
| M-2 | Switch Gemini API key from `?key=` query to `x-goog-api-key` header | **S** | Two call sites (`fetchModels.ts:178`, `GeminiProvider.ts:28`); also audit error paths for URL echo into Notices. |
| M-7 | Move snapshot directory under `vault.configDir/plugins/frontmatter-editor/snapshots/` | **M** | One-shot migration on plugin load to relocate existing snapshots and delete the vault-side directory; update README; verify list/get/delete still work; consider feature flag for the migration. |

P3 items are tracked as hardening for the release after H-1/M-7 land. Several (L SCA caret-pinning, L OpenRouter Referer URL, L impersonation version constants) are one-line changes worth folding into the same release. The two LLM Top 10 items (L-1 LLM prompt-delimiter wrap, L-2 narrow refusal substrings) deserve a dedicated PR with a small fixture vault that exercises both happy and adversarial paths.

## Release recommendation

**AMBER.** Two High findings (H-1 plaintext secrets, H-5 transfer-snapshot un-restorable) and two Medium findings (M-2 Gemini key in URL, M-7 snapshot leak via vault sync) must land before any public-marketplace submission. All four are mechanical fixes in already-isolated modules; aggregate effort estimate is ~1-2 engineer-days.

After P1+P2 land, schedule a re-audit focused specifically on:
1. Verifying the SafeStorage wiring covers every save path (including migration of existing data.json).
2. Running the snapshot round-trip test across all six action types.
3. Re-running `npm audit --omit=dev` on the updated lockfile.
4. Re-confirming the providerUrlGuard still rejects every host in `BLOCKED_HOSTNAMES` after any provider-list changes.

If the plugin ever adds a vault-MCP server, a public webhook endpoint, or accepts content from untrusted callers (not peer plugins), reassess every "Mitigated" status -- several of the AUDIT-037/038 guards rely on the trust model that says no inbound network traffic is possible.

---

## Status table

| ID | Theme | Severity | Status |
|---|---|---|---|
| H-1 | SafeStorageService dead code -- plaintext secrets | High | **Open** |
| H-5 | parseSnapshot missing 'transfer' action | High | **Open** |
| M-2 | Gemini API key in URL query string | Medium | **Open** |
| M-7 | Snapshot dir inside vault -- sync leak | Medium | **Open** |
| L-1 (LLM) | Prompt injection -- no delimiter wrap | Low | Open |
| L-2 (LLM) | Refusal substring false positives | Low | Open |
| L-1 (SCA) | AWS SDK caret pinning | Low | Open |
| L-2 (SCA) | typescript-eslint chain low advisories | Low | Open |
| L-2 (SAST) | OpenRouter HTTP-Referer dev-repo leak | Low | Open |
| L-4 (SAST) | Gateway header validation | Low | Open |
| L-1 (ZT) | Codex raw https bypass / no mobile gate | Low | Open |
| L-3 (ZT) | BulkAction snapshot race | Low | Open |
| L | Impersonation client-ids + headers | Low | Open |
| L | Generator runs uncancellable | Low | Open |
| L | Kilo manual-token UX | Low | Open |
| I | SCA AWS subtree clean | Info | Confirmed positive |
| I | Vault write boundary holds | Info | Confirmed positive |
| I | console.debug logging audit clean | Info | Confirmed positive |
| -- | providerUrlGuard SSRF defence | Mitigated | AUDIT-037/038 carry-over verified |
| -- | PKCE state validation | Mitigated | Confirmed end-to-end |
| -- | Loopback port fallback | Mitigated | Iterates 1455..1460 |
| -- | OAuth refresh promise lock | Mitigated | Concurrent callers await one refresh |
| FP-* | 23 refuted findings | n/a | False Positive |


---

## Re-Audit Delta -- post-fix commits

```
=== Re-Audit Delta ===

Before: 2 P1, 2 P2, 12 P3
After:  0 P1, 0 P2, 2 P3 (Kilo UX + Impersonation -- accepted as TOS/UX, not security)

Resolved:
- H-1: SafeStorage wired into encryptSettingsForSave + decryptSettingsAfterLoad,
       called in load/saveSettings; 11 secret fields (3 OAuth flows + 6 provider keys)
       round-trip via Electron safeStorage; assertNoPlaintextSecrets guard fires
       on every save when keychain available. Migration is implicit: legacy
       plaintext loads pass through decrypt unchanged, get encrypted on next save.
       Test: src/__tests__/EncryptSettings.test.ts (15 tests).
- H-5: parseSnapshot whitelist now derived from BULK_ACTION_TYPES union;
       'transfer' flows through; future action types added to the union
       are auto-accepted.
- M-2: Gemini API key moved from ?key= query string to x-goog-api-key header
       on both inference (GeminiProvider.ts) and discovery (fetchModels.ts:178)
       call sites.
- M-7: Snapshot dir moved from vault-root .frontmatter-editor/snapshots/ to
       vault.configDir/plugins/frontmatter-editor/snapshots/; one-shot
       migration on ensureDir() relocates existing snapshots; legacy dir
       deleted when empty. Snapshots no longer mirror to iCloud/Sync.
- L-1 LLM: NOTE_BODY wrapped in <note_body_untrusted>...</note_body_untrusted>
           delimiter; sanitiseForPrompt strips ASCII control bytes
           (preserving \\n, \\r, \\t).
- L-2 LLM: RefusalTagCleanupService scope defaults to "targeted" (curated
           generator-target properties: tags, keywords, aliases, topics,
           concepts, moc, description, summary). Opt into vault-wide sweep
           via scope: "all".
- L-1 SCA: AWS SDK runtime deps tightened from ^3 to ~3.1075.0 (no
           uncontrolled minor drift).
- L-2 SAST: HTTP-Referer URL pointed at canonical github.com/pssah4/
            frontmatter-editor (was -dev fork).
- L-4 SAST: src/api/headerValidation.ts -- RFC 7230 token check on
            header names + printable-ASCII (no CR/LF/NUL) check on values
            + blocklist of reserved names (Host, Authorization, etc.);
            assertValidHeader called at BedrockProvider gateway-mode
            construction AND AnthropicProvider every-request injection
            site. Test: src/__tests__/HeaderValidation.test.ts (7 tests).
- L-1 ZT: ChatGptResponsesProvider throws clean ProviderError at
          construction when Platform.isMobile (was opaque
          "require is not a function" mid-request).
- L-3 ZT: BulkActionService.executeAction re-reads frontmatter via
          metadataCache before each write; if it diverges from the
          snapshotted `before`, the note is skipped and counted as
          racedSkipped instead of clobbering a concurrent edit.
- L generator: GeneratorRunOptions.abortSignal + per-iteration
               check; remaining notes counted as skipped with reason
               "cancelled by user" when fired.

Deferred (defended as acceptable):
- L Kilo manual-token UX surface: low-impact UX item, not security.
  Tracked in backlog.
- L Impersonation client-ids + version strings: load-bearing for backend
  acceptance; documented in code comments; backend-roll detection happens
  via the HTTP 400 "not supported" error path which already prompts a
  plugin update.

Newly added tests: 22 (EncryptSettings + HeaderValidation).
Total tests: 257 -> 279, all green.

Final overall risk: Low (was High).
Release recommendation: GREEN.
```
