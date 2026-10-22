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
