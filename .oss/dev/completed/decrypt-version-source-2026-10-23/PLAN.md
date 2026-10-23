# Implementation Plan: decrypt-version-source

## Summary
`oss-decrypt --version` prints `1.2.1` because the version lives in two places: `packages/cli-decrypt/package.json`
(1.2.3) and the hard-coded `VERSION` in `src/index.ts` (1.2.1). PRs #176/#177 bumped only package.json, and the
released v1.2.3 binaries are built from source, so they report 1.2.1. Fix it so a release cannot ship with a
mismatch again, release v1.2.4, then point the install hook at v1.2.4. Also ship FOLLOWUPS line 46 (security LOW,
same binary): the keyed fetches put names into the URL unencoded and follow redirects with the Bearer key.

## Scope (smallest useful cut)
- IN: one checked source for the version, a release-time tag check, URL-encode names, refuse redirects on keyed
  fetches, v1.2.4 release, hook pin + committed checksums + test fakes, plugin version bump.
- OUT: changing MINIMUM_VERSION (stays 1.2.1, so existing installs are NOT forced to re-download);
  migrating off pkg (separate); any other FOLLOWUPS item.

## Two PRs, two user gates
1. **PR 1 (Phase 1–2):** CLI source + release workflow guard + rebuilt bundle, version 1.2.4.
   → user go to merge → user go to push tag `cli-decrypt-v1.2.4` (GitHub builds + publishes 4 binaries).
2. **PR 2 (Phase 3):** hook pins v1.2.4 with the release's checksums; plugin version bump. → user go to merge.
PR 2 cannot be built before the release exists (it needs the real checksums).

## TDD Implementation Tasks

### Phase 1 — CLI version (PR 1)

#### Task 1: `--version` reports the package version
**Objective:** VERSION and package.json can never disagree unnoticed.
**Behavior:** a user running `oss-decrypt --version` sees the version that was released.
**Tests (RED):** `packages/cli-decrypt/test/version.test.ts`
- `should report the package.json version` — `VERSION` from `src/index.ts` equals `package.json` `version`
  (fails today: 1.2.1 vs 1.2.3).
- `should print that version from the CLI` — the built bundle `dist/oss-decrypt.cjs --version` prints
  `oss-decrypt v<package version>` (run with node; guards the shipped artifact, not only the source).
**GREEN:** set `VERSION` and package.json to `1.2.4`; rebuild the tracked `dist/oss-decrypt.cjs`
(`npm run build:bundle`). Keep the constant (tsconfig `rootDir: ./src` forbids importing ../package.json;
the test is the single-source guard). Minimal.
**Provenance check:** grep every other place a decrypt version is stated (`1.2.1`, `1.2.3`, `cli-decrypt-v`) —
hook, checksums header, hook tests, new-user acceptance test, login.md — and record each in the commit body
(Phase 3 changes the hook-side ones).

#### Task 2: release refuses a tag that does not match the source
**Objective:** the root cause (tag/package bumped, source not) fails the release instead of shipping.
**Tests (RED):** extend `packages/cli-decrypt/test/build-targets.test.ts`
- `should check the tag against package.json and VERSION before building` — the workflow has a step, before
  `Build bundle`, that fails when `${GITHUB_REF_NAME#cli-decrypt-v}` differs from package.json `version` or from
  `VERSION` in `src/index.ts`.
- Behavioural: extract that step's script and run it with bash against (a) matching values → exit 0,
  (b) a mismatching tag → non-zero, (c) a mismatching VERSION → non-zero (anti-vacuity: each condition has its
  own failing case).
**GREEN:** one `run:` step in `.github/workflows/release-cli-decrypt.yml` build job.

### Phase 2 — keyed fetch hardening (PR 1, FOLLOWUPS line 46)

#### Task 3: names are URL-encoded
**Behavior:** a prompt or team-command name can only ever address its own endpoint (no `../` or `?` reaching
another API path with the user's key).
**Tests (RED):** `test/api-client.test.ts`
- `fetchCustomPrompt should encode the name` — name `a/../b?x=1#y` (covers `/`, `..`, `?`, `#`) → fetch URL ends `/custom/a%2F..%2Fb%3Fx%3D1%23y`.
- `fetchEncryptedPrompt should encode the name` — same, for `commands`, `workflows` and a typed path.
**GREEN:** `encodeURIComponent(name)` at both sites (fetchCredentials already encodes).

#### Task 3b: `--type` is checked against the allowlist (found in build, 2026-10-22)
**Behavior:** same class as Task 3, second site: the typed branch builds `/api/v1/prompts/${type}/…` from
`--type`, which `cli-entry.ts` only casts and never checks, so `--type 'x/../../auth/y?'` sends the key elsewhere.
The plugin's wrappers are safe (oss-value.sh checks the category); a direct CLI call is not.
**Tests (RED):** an unknown `--type` is rejected before any request (no fetch call), with a clear error;
every type the plugin uses still works.
**GREEN:** reject types outside the existing allowed list (reuse the one `cache.ts` `validateType` uses — one
source, not a second list).

#### Task 4: keyed requests never follow a redirect
**Behavior:** the API key is sent only to the configured API URL, never to wherever a redirect points.
**Tests (RED):** `test/api-client.test.ts`
- each of `fetchCredentials`, `fetchEncryptedPrompt`, `fetchCustomPrompt` passes `redirect: 'error'` to fetch
  (one test per function so removing it from any one site fails).
- integration (real `fetch`, local `http.createServer` that answers 302 to a second local server): the call
  rejects and the second server receives no request (proves the option does what the mock assumes).
**GREEN:** add `redirect: 'error'` at the three keyed sites. `fetchManifest` sends no key; leave it.
**Pre-checked 2026-10-22:** the prod API answers `/prompts/manifest` 200, `/prompts/workflows/build` and
`/auth/credentials` 401 with no redirect, so default users are unaffected.

#### Task 5: rebuild + package checks
- `npm run build:bundle`; whole cli-decrypt suite green; tsc clean. Bundle contains `1.2.4`.

### Ship round 1 fixes (PR 1, 2026-10-23; user chose: toolchain in PR 1, two design items to their own feature)
Each task RED first, each guard checked by mutation. Only `packages/cli-decrypt` + the release workflow.

#### R1-1 (security LOW, branch-scoped): names `.` / `..` cannot reach a parent path
`encodeURIComponent` keeps `.`; URL parsing resolves `..` → the key reaches `/api/v1/` or `/api/v1/prompts/`.
**RED:** for every type branch + custom: names `.`, `..`, `''` reject before any fetch. **GREEN:** call the existing
`validateName` (cache.ts) in `fetchEncryptedPrompt` and `fetchCustomPrompt` (one rule, two callers; check it accepts
every real plugin name).

#### R1-2 (matters, introduced by T4): a refused redirect says so
**RED:** real-fetch redirect → error message names the redirect and apiUrl (not bare "fetch failed"), key absent.
**GREEN:** map the fetch rejection whose cause is the redirect refusal to a fixed message at the 3 keyed sites (one helper).

#### R1-3 (security LOW, pre-existing): the key never appears in an error
A key with an embedded CR/LF/NUL makes undici throw `invalid header value "Bearer <key>"`, printed by cli.ts.
**RED:** each keyed function with such a key rejects with a message that does not contain the key. **GREEN:** fixed message.

#### R1-4 (security LOW, pre-existing): server error text is printed without control characters
**RED:** an API error body with ESC/CR/BEL sequences → the thrown message has none. **GREEN:** strip C0/C1 + DEL.

#### R1-5 (security LOW, pre-existing + IRON LAW 1b): one apiUrl source, https only
`getApiUrl` exists in decrypt.ts and cli-entry.ts (different config-dir rules) and setup.ts reads apiUrl a third way.
**RED:** http:// (non-loopback), a URL with query or fragment, and garbage are refused before any keyed request;
`http://127.0.0.1`/`localhost` allowed; all three sites resolve the same value under OSS_CONFIG_DIR.
**GREEN:** one exported helper used by all three sites.

#### R1-5b (security LOW, found by R1-5's provenance grep): the hook follows the same apiUrl rule
`hooks/oss-notify.sh` (`start` branch, analytics/track) reads `.apiUrl` and sends the Bearer key there with no check,
so it accepts an `http://` / `?x=` apiUrl the CLI now refuses. **RED:** hook test: http (non-loopback), `?`, `#` apiUrl
→ no request carries the key; https and loopback http still sent. **GREEN:** the same rule in the hook (skip the
best-effort analytics call when the URL fails it).

#### R1-5c (security LOW + broken default, found by R1-5b's provenance grep): settings.md / telegram.md
`commands/settings.md` and `commands/telegram.md` (8 snippets) read `.apiUrl` with no check, default to
`https://api.oneshotship.com` (does NOT resolve, checked 2026-10-23; the real API is one-shot-ship-api.onrender.com),
and pass the key as `curl -H "Authorization: Bearer $API_KEY"` (key in the process list), unlike hooks' `oss_api_curl`.
**RED:** a test over `commands/*.md`: no `Authorization: Bearer $` on a curl command line; every `.apiUrl` read uses the
real default and goes through the same rule (https or loopback http, no ?/#). **GREEN:** one small shared hook helper
(e.g. `oss_api_url` next to `oss_api_curl`, used by oss-notify.sh too) and the snippets call it + `oss_api_curl`.

#### R1-5d (matters, same provenance): /oss:trust allowlists the real API host
`commands/trust.md:219` exfiltration allowlist names `api.oneshotship.com` (does not resolve) and not the real API
host, so a served prompt that names `one-shot-ship-api.onrender.com` is reported as exfiltration. It is now the last
file naming that host. **RED:** a test that the allowlist names `one-shot-ship-api.onrender.com` and no non-resolving
host. **GREEN:** replace the host.

#### R1-6 (CRITICAL/HIGH CVEs): clean toolchain
`pkg` (HIGH, no fix) → `@yao-pkg/pkg`; targets node18 → node22 (package.json `build:binary`, workflow matrix,
build-targets.test.ts, esbuild `--target`); CI `node-version` 22; vitest 3 → 5; esbuild → 0.28.
**RED:** a test that `npm audit` reports 0 (or a test asserting the lockfile has no `pkg` and targets are node22);
**GREEN:** upgrades; full suite green; `npm audit` 0; bundle rebuilt.

#### R1-7 (security MEDIUM/LOW): release workflow supply chain
`npm install -g pkg` unpinned → use the lockfile's binary (`npx --no-install pkg` / `./node_modules/.bin/pkg`);
pin every action to a commit SHA; build job `permissions: contents: read`; version check before `npm ci`.
**RED:** build-targets.test.ts asserts each of these. **GREEN:** workflow edits.

### Ship round 2 fixes (2026-10-23; all security LOW/INFO from the round-2 gate, in this PR's code)
#### R2-1: one apiUrl rule, same answer in TS and bash, one table of cases
`config.ts` accepts a JSON array (`Array.includes('?')` is false) and normalises forms bash refuses (uppercase,
`127.1`, leading space); zsh `=~` stops at NUL; curl and fetch disagree on `https://a@b`.
**RED:** one shared fixture of URL cases (`packages/cli-decrypt/test/fixtures/api-url-cases.json`: input → accept/
refuse) run by a vitest test against `getApiUrl` AND by a bash test against `oss_api_url` (bash + zsh). Includes:
non-string, control chars/NUL/whitespace, userinfo `@`, uppercase scheme, `127.1`, `localhost.`, `?`, `#`, globs.
**GREEN:** the literal rule in both: string only; no control chars or whitespace; no `@`; no `?`/`#`; starts with
`https://` + host, or matches the loopback http regex; then (TS) `new URL` must parse. Return the input unchanged.
#### R2-2: key and URL from the same config dir (bash)
`oss_api_url` honours `${OSS_CONFIG_DIR:-$HOME/.oss}` like the CLI; add `oss_api_key` reading the same file;
snippets and oss-notify use it. No-jq fallback: no custom apiUrl without jq (default URL only).
#### R2-3: curl never reads a .curlrc or globs
`oss_api_curl` passes `-q` first and `--globoff`. **RED:** a HOME/.curlrc with `url =`/`trace-ascii` gets no key.
#### R2-4: every printed error and echoed server field is stripped
`cli.ts` prints `stripControl(err.message)` (`err: unknown`, no implicit any); `stripControl` also removes bidi and
zero-width (U+200B–U+200F, U+202A–U+202E, U+2066–U+2069). telegram.md strips server fields it echoes.
#### R2-5: oss-notify analytics body is JSON-escaped (`WORKFLOW_CMD` into `-d`)
#### R2-6: release build: `persist-credentials: false` on checkout; no shared npm cache in the tag build

Logged, not fixed here (user decision 2026-10-23): credentials.enc key derivation (move to OS keychain) and
refusing to send the key when TLS verification is disabled / proxy set → security FOLLOWUPS, own feature.

### — GATE: user go → merge PR 1 → user go → push tag `cli-decrypt-v1.2.4` —
- Watch the release workflow; confirm 4 binaries + 4 `.sha256` assets on the v1.2.4 release.
- Download each asset; verify its sha against the in-release `.sha256`; run the Darwin-arm64 binary
  `--version` → `oss-decrypt v1.2.4`; for Linux-arm64 check with `strings` (DeepBlue is busy with the eval
  ladder — do not run anything there without the eval session's OK).

### Phase 3 — hook pins v1.2.4 (PR 2)

#### Task 6: hook pin and committed checksums follow the release
**Tests (RED):** `hooks/__tests__/ensure-decrypt-cli.test.sh`
- `pinned tag matches the CLI package version` — `OSS_DECRYPT_TAG` default in `hooks/ensure-decrypt-cli.sh`
  equals `cli-decrypt-v<packages/cli-decrypt/package.json version>` (fails: v1.2.3 vs 1.2.4).
- `committed checksums header names the pinned tag`.
- Test fakes report `oss-decrypt v1.2.4` (what the real pinned asset now reports); the existing
  "no re-download at the pinned version" case keeps passing; MINIMUM_VERSION stays 1.2.1 and an installed
  1.2.1 binary is NOT re-downloaded (existing users untouched).
**GREEN:** tag → `cli-decrypt-v1.2.4`; `hooks/oss-decrypt-checksums.txt` → the 4 release hashes (from the
downloads verified at the gate); fix the "reports 1.2.1" comment; update `__tests__/new-user-install.acceptance.test.sh`
if it pins the tag.

#### PR2-R1 (ship gate, all 4 reviewers MEDIUM; user decision 2026-10-23): existing installs get v1.2.4
MINIMUM_VERSION 1.2.1 keeps every existing binary (v1.2.3 reports "1.2.1"), so v1.2.4's security fixes reach only
new installs. **RED:** an installed binary reporting 1.2.1 (and 1.2.3) IS replaced by the pinned v1.2.4; one reporting
1.2.4 is kept with no download. **GREEN:** MINIMUM_VERSION="1.2.4"; comment says why it is now safe (the pinned binary
reports 1.2.4, so no re-download loop). Supersedes D2.

#### PR2-R2 (round 2, 3 reviewers; user chose "soft upgrade" 2026-10-23)
With the 1.2.4 floor, a failed upgrade download (offline, GitHub blocked, slow link hitting the ~2 min tool timeout)
exits 1 and blocks every /oss command although a working older binary is installed. Also nothing checks the version a
new binary reports before installing it (re-download loop if an asset ever reports below the floor).
**RED:** (a) installed runnable v1.2.1 + download/verification-of-download failure → warning on stderr, exit 0, old binary
kept and still runnable; (b) a hash MISMATCH (in-release or committed) with an older binary installed → still exit 1
(tamper is never soft); (c) no binary installed + download fails → exit 1 (unchanged); (d) a verified asset that
reports a version below MINIMUM_VERSION is NOT installed (exit non-zero or soft-fail per (a), old binary kept).
**GREEN:** minimal: soft-fail only for network/download failures when a runnable binary exists; post-install version
check against MINIMUM_VERSION before `mv`.

#### PR2-R3 (round 3, user chose "one bounded fix round" 2026-10-23; LAST change to PR 2)
Hook only (hooks/ensure-decrypt-cli.sh + its tests):
1. One deadline per upgrade: fetch .sha256 first (--max-time 15), then the binary with the remaining budget
   (total <= 100 s); first installs unchanged (no cap).
2. After a failed upgrade on the soft path, write a stamp (e.g. ~/.oss/bin/.decrypt-upgrade-failed) and skip
   upgrade attempts for 6 h (fast exit 0 with the installed binary); a successful install removes the stamp.
3. An unparseable/empty .sha256 (captive portal) counts as a failed download -> soft path when runnable;
   a real hash mismatch stays hard.
4. HAVE_RUNNABLE only if `--version` exits 0, first match only, and version >= 1.2.1 (old floor).
Each item RED first; mutation-checked.

#### Task 7: plugin version bump
- `.claude-plugin/plugin.json` patch bump (triggers auto-update).

## Testing Strategy
- Unit: version, workflow guard, URL encoding, redirect option per site.
- Integration: real fetch against local servers (redirect refused, key never reaches the second server);
  real bash run of the workflow guard step; `--version` from the built bundle.
- Edge: name with `/`, `..`, `?`, `#`; tag with and without matching VERSION; installed 1.2.1 binary not
  re-downloaded.

## Security Checklist
- [x] API key never sent across a redirect (Task 4)
- [x] Names cannot reach other endpoints (Task 3)
- [x] Hook stays two-method fail-closed: in-release sha AND committed sha (Task 6 only changes the values)
- [x] No secrets in tests (fake keys only)

## Performance Considerations
- None (one extra CI step; no runtime cost).

## Rollout
- Existing installs keep their binary (MINIMUM unchanged). New installs and anyone whose binary is missing get
  v1.2.4 once PR 2's plugin version auto-updates.
- Rollback: revert PR 2 (hook back to v1.2.3 + its checksums); the v1.2.3 release stays published.

## Estimated Tasks: 7 (+1 release gate)
## Estimated Test Cases: ~16
