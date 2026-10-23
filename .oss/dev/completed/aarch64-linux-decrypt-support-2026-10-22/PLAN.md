# PLAN: aarch64 / ARM64 Linux Support for oss-decrypt

**Repo:** `one-shot-ship-plugin`
**Branch:** `feat/aarch64-linux-decrypt-support/build` (cut from `origin/main`)
**Methodology:** London TDD — RED → GREEN → REFACTOR. Every code change starts failing.
**Created:** 2026-06-26

> ⛔ IRON LAW #4: branch off `main`, never push to main. This work is in the **plugin
> repo**, not AgenticDevWorkflow. Verify `git branch --show-current` before any git op.

---

## Phase 1 — Hook: aarch64 → arm64 mapping (TDD, bash harness)

Test harness: `hooks/__tests__/ensure-decrypt-cli.test.sh` (PATH-mocks `curl`; we extend
it to PATH-mock `uname` so we can drive `aarch64`/`Linux` without an ARM host).

### Task 1 — RED: failing test for aarch64 install
- **Behavior:** "On an aarch64 Linux host, the hook installs the `*-Linux-arm64` binary."
- **Business rule:** aarch64 Linux is a supported target; no manual install required.
- Add `test_aarch64_installs_arm64_binary` to the test file:
  - Add a `setup_mock_uname <os> <machine>` helper (PATH-mock that returns `Linux`/`aarch64`).
  - Reuse `setup_mock_curl` to serve a fake arm64 binary + matching checksum for the
    `oss-decrypt-Linux-arm64` URL.
  - Assert: exit 0 **and** output contains `checksum.*verif` **and** the requested URL
    ended in `-arm64` (have mock curl append `$URL` to a log file; grep it).
- **RED proof:** run the harness → new test FAILS (current hook prints
  `Unsupported architecture: aarch64`, exit 1).
- **Files:** `hooks/__tests__/ensure-decrypt-cli.test.sh`

### Task 2 — GREEN: add the mapping (minimal)
- In `ensure-decrypt-cli.sh`, immediately after the `x86_64→x64` line:
  ```bash
  [[ "$ARCH" == "aarch64" ]] && ARCH="arm64"
  ```
- **MINIMAL:** one line. Do NOT touch checksum/verify/download logic.
- **GREEN proof:** harness → Task 1 test passes; all 8 pre-existing tests still pass.
- **Files:** `hooks/ensure-decrypt-cli.sh`

### Task 3 — REFACTOR: make host-arch test aarch64-aware
- `test_platform_detection` (lines ~117-132) normalizes only `x86_64`; on a real aarch64
  host it would now wrongly fail. Add the `aarch64→arm64` normalization there too so the
  suite is green when RUN on the GB10.
- **Proof:** harness green on both x64 and (simulated) aarch64 normalization paths.
- **Files:** `hooks/__tests__/ensure-decrypt-cli.test.sh`

---

## Phase 2 — Release pipeline: publish oss-decrypt-Linux-arm64 (config + build verify)

### Task 4 — RED: failing build-artifact assertion
- **Behavior:** "`npm run build:binary` produces a runnable Linux/arm64 binary."
- Add `test/build-targets.test.ts` (vitest) OR a shell check that asserts
  `dist/bin/oss-decrypt-Linux-arm64` exists after `build:binary` and `file` on it reports
  `ARM aarch64`. (Prefer a thin vitest spec invoking `file` via `execSync`, guarded to
  skip if `pkg`/`file` unavailable — but it must FAIL now because the target is missing.)
- **RED proof:** test fails — `build:binary` targets don't include `node18-linux-arm64`,
  so the artifact is absent.
- **Files:** `packages/cli-decrypt/test/build-targets.test.ts`

### Task 5 — GREEN: add the arm64 target
- `package.json` `build:binary`: append `,node18-linux-arm64` to `--targets`.
- `release-cli-decrypt.yml`:
  - Add matrix entry: `{ os: ubuntu-latest, target: node18-linux-arm64,
    artifact: oss-decrypt-Linux-arm64 }`.
  - Add to the `release` job `files:` list:
    `artifacts/oss-decrypt-Linux-arm64/oss-decrypt-Linux-arm64` and its `.sha256`.
- **GREEN proof:** local `npm run build:binary` → Task 4 test passes (`file` → ARM aarch64).
- **Files:** `packages/cli-decrypt/package.json`,
  `.github/workflows/release-cli-decrypt.yml`

---

## Phase 3 — Release + end-to-end validation (ship/deploy)

### Task 6 — Cut the release
- Bump `packages/cli-decrypt/package.json` version `1.2.1 → 1.2.2`.
- Merge feature PR to main, then tag `cli-decrypt-v1.2.2` and push → triggers
  `release-cli-decrypt.yml`.
- **Verify:** `gh release view --repo 501336North/one-shot-ship-plugin` lists
  `oss-decrypt-Linux-arm64` **and** `oss-decrypt-Linux-arm64.sha256` on `latest`.

### Task 7 — E2E on the GB10 (real aarch64) — incl. /oss:trust
- On the GB10: run `/oss:login` (computes hardware ID locally — see DESIGN risk note),
  then `~/.oss/hooks/ensure-decrypt-cli.sh`.
- **Verify install/decrypt:** binary downloads, checksum "verified",
  `~/.oss/bin/oss-decrypt --version` prints `1.2.2`, and `/oss:queue` / `/oss:build`
  decrypt a prompt successfully (no "Unsupported architecture", no 404).
- **Verify trust on arm64:** run `~/.oss/bin/oss-decrypt --verify-manifest` and
  `/oss:trust` on the box → manifest signature `valid`, prompt hashes `verified`,
  `--list-prompts --category commands` returns the catalog. (Proves the Ed25519/SHA-256
  trust path runs correctly on the cross-compiled arm64 binary.)

### Task 7.5 — Run trust unit suites against the build (CI)
- In `release-cli-decrypt.yml` (or the PR CI), ensure `trust-acceptance.test.ts`,
  `manifest-verifier.test.ts`, `prompt-integrity.test.ts`, `decrypt-integrity.test.ts`
  pass on the build. These are arch-independent (pure node crypto); they guard against any
  accidental change to the trust path while we touch the build config.

---

## Phase 4 — Ship the hook fix to users + docs

### Task 8 — Plugin bump + platform docs
- Bump `.claude-plugin/plugin.json` `2.0.73 → 2.0.74` (triggers user auto-update of the
  patched hook).
- Update any "supported platforms" copy (e.g. `commands/login.md`, README install notes)
  to list **Linux aarch64/arm64** alongside x64 and macOS.
- **Verify:** grep shows no remaining "x64-only" platform claims for Linux.

---

## Task → file → test matrix

| Task | Type | Files | Verified by |
|------|------|-------|-------------|
| 1 | RED | test.sh | harness shows new test failing |
| 2 | GREEN | ensure-decrypt-cli.sh | harness 9/9 green |
| 3 | REFACTOR | test.sh | harness green incl. aarch64 normalization |
| 4 | RED | build-targets.test.ts | vitest fails (no arm64 artifact) |
| 5 | GREEN | package.json, release yml | `build:binary` → `file`=ARM aarch64 |
| 6 | deploy | package.json (version) | `gh release view` shows arm64 asset |
| 7 | E2E | — (GB10) | hook installs + decrypt works on box |
| 8 | ship | plugin.json, login.md/README | plugin 2.0.74, docs updated |

## Sequencing / dependencies
- Phase 1 and Phase 2 are independent → can run in parallel.
- Phase 3 depends on BOTH (hook mapping + published asset).
- Task 7 (GB10 E2E) is the real acceptance gate; it can only pass after Task 6 publishes
  `latest`.

## Definition of done
- Hook maps aarch64→arm64; harness green (9 tests).
- `latest` release carries `oss-decrypt-Linux-arm64` + `.sha256`.
- GB10 runs `/oss:queue`/`/oss:build` with successful local decryption.
- Plugin 2.0.74 shipped; platform docs mention aarch64 Linux.
