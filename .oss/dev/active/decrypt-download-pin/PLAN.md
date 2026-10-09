# PLAN: decrypt-download-pin (TDD)

**Repo:** one-shot-ship-plugin · **Branch:** `fix/decrypt-download-pin/build` from `origin/main` (worktree `~/dev/oss-wt-decrypt-pin`)
**Design:** DESIGN.md · **Tests:** shell harnesses in `hooks/__tests__/` + `__tests__/` (repo convention), vitest only if touched.

## Task 0 (OPS, gated on Boss's explicit OK — not a code task)
Mark `cli-decrypt-v1.2.3` as Latest: `gh release edit cli-decrypt-v1.2.3 --repo 501336North/one-shot-ship-plugin --latest`.
Verify: `curl -sIL …/releases/latest/download/oss-decrypt-Darwin-arm64` → 200 for all 4 + `.sha256`; `ensure-oss-launch.sh` unaffected (it is tag-pinned).
Rollback: `gh release edit oss-launch-v2.0.78 --latest`.

## Task 1: ensure-decrypt-cli.sh downloads from a pinned tag
**RED** (`hooks/__tests__/ensure-decrypt-cli.test.sh`, new test 10, mirrors ensure-oss-launch T3):
- `should fetch oss-decrypt from releases/download/cli-decrypt-v1.2.3/ when no override is set` — URL-recording fake curl; assert every requested URL contains `/releases/download/cli-decrypt-v1.2.3/` and none contains `/latest/`.
- `should honour OSS_DECRYPT_TAG override` — set `OSS_DECRYPT_TAG=cli-decrypt-v9.9.9`; URLs contain it (test seam, same as `OSS_LAUNCH_TAG`).
Must fail on current code (it requests `latest/download`).
**GREEN:** `OSS_DECRYPT_TAG="${OSS_DECRYPT_TAG:-cli-decrypt-v1.2.3}"`; `GITHUB_RELEASES=".../releases/download/$OSS_DECRYPT_TAG"`. Nothing else.
**REFACTOR:** header comment states why it is pinned (link DESIGN.md). Existing tests 1–9 stay green.

## Task 2: /oss:login installs through the hook (one downloader)
**RED** (`hooks/__tests__/login-setup-gate.test.sh` or new `__tests__/login-decrypt-install.test.sh`):
- `login.md's install step should invoke ensure-decrypt-cli.sh` — assert Step 5 calls `~/.oss/hooks/ensure-decrypt-cli.sh` (with the plugin-root fallback if the hooks copy is absent) and contains no `curl … oss-decrypt` URL of its own.
**GREEN:** replace Step 5.2's inline curl with the hook call; keep the existing verifier gate (step 4) unchanged.
**REFACTOR:** platform note stays; remove duplicated arch-mapping text.

## Task 3: guard the class — no `latest/download` in shipped files
**RED** (`__tests__/no-latest-download.test.sh`): grep `hooks/ commands/ bin/ scripts/ skills/ agents/` (excluding `__tests__`, `.oss/`, `dist` docs) for `releases/latest/download`; fail listing each hit. Write it BEFORE Tasks 1–2 land on a scratch revert to watch it go red on today's code (2 hits).
**GREEN:** passes once Tasks 1–2 are in.

## Task 4: oss-launch releases never take "Latest"
**RED** (`__tests__/release-workflows.test.sh`): assert `build-oss-launch.yml`'s release job runs `gh release edit "$TAG" --latest=false` after creating the release (the pinned softprops SHA has no `make_latest` input — verified 2026-10-09).
**GREEN:** add that step (uses `GITHUB_TOKEN`, `contents: write` already granted). No other workflow changes.

## Task 5: clean-machine acceptance (integration, before ship)
Fresh `HOME` (temp dir), no `~/.oss/bin`: run the real hook against the real GitHub release → binary installed, SHA-256 verified, `oss-decrypt --version` = 1.2.3. Then on a throwaway account/key if available: `/oss:login` → `--setup` → one prompt fetch. Record in TESTING.md. (Network test, not in the unit suite.)

## Provenance check (IRON LAW #1b) — done at plan time
`grep -rn "releases/(latest/)?download"` over the repo: download sites = `hooks/ensure-decrypt-cli.sh`, `commands/login.md` (latest — both fixed here), `hooks/ensure-oss-launch.sh`, `scripts/verify-release.sh` (already tag-pinned, correct as-is). `bin/oss-launch`, `verify-decrypt-setup.sh`, `oss-notify.sh` reference the binary but never download it.

## Sequence
Task 0 (when approved, independent) · Task 3 RED → Task 1 → Task 2 → Task 3 GREEN → Task 4 → Task 5 → /oss:ship (PR, Boss merges).
Version bump: plugin patch version per repo convention, so marketplace users pick the fix up.

## Estimated: 5 tasks (+1 ops), ~6 tests
