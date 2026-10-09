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


## Task 1b: committed known-good hash manifest (two-method verify, same standard as oss-launch)
Added 2026-10-09 after Boss asked to check the dev docs for our crypto standard. `oss-launch-release-hardening`
(DESIGN.md) set it: pinned tag + in-release `.sha256` + a COMMITTED, code-reviewed hash manifest, fail-closed.
`ensure-decrypt-cli.sh` only had the in-release `.sha256`. (Prompt-level Ed25519 manifest signing lives in the
binary and is untouched by this work.)
**RED** (`hooks/__tests__/ensure-decrypt-cli.test.sh`):
- committed hash matches → installs
- committed hash MISMATCH while in-release `.sha256` matches → rejects, nothing executable left (release-tamper defense)
- manifest has no entry for this OS/arch → rejects (fail-closed, never trust-on-first-use)
- manifest not beside the hook (e.g. `~/.oss/hooks/` copy) → found via `$(cat ~/.oss/plugin-root)/hooks/`
- existing tests 6–10 supply a manifest through the `OSS_DECRYPT_CHECKSUMS` seam (they must not be weakened)
**GREEN:** `hooks/oss-decrypt-checksums.txt` = SHA-256 of the 4 `cli-decrypt-v1.2.3` binaries (downloaded, hashed,
cross-checked against the release `.sha256`; reviewed in the PR = the gate). Verify block mirrors ensure-oss-launch.sh.
**CUSTOMER-SAFETY (must hold):** the hook only downloads when the binary is missing or < MINIMUM_VERSION, so
existing installs never reach the new check. Fresh installs need the manifest reachable from `~/.oss/hooks/`.

## Task 1c: session start copies the manifest next to the hook
**RED:** session-start test asserts `oss-decrypt-checksums.txt` is copied into `~/.oss/hooks/` with `ensure-decrypt-cli.sh`.
**GREEN:** add it to `HOOKS_TO_COPY` in the session-start script that hooks.json actually runs (provenance: check the `-new`/`-test` variants too).

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

## Customer-safety checklist (Boss, 2026-10-09)
- Existing installs (binary ≥ MINIMUM_VERSION) never download → unaffected by every change here.
- Users on old plugin versions: covered by the Latest flip (Task 0, done) — their old hooks resolve latest → cli-decrypt-v1.2.3 (verified: real install with origin/main hook succeeded).
- oss-launch is tag-pinned → unaffected by the flip (verified 200).
- Note: the cli-decrypt-v1.2.3 Darwin-arm64 binary reports `v1.2.1`; fine for MINIMUM_VERSION=1.2.1, but NEVER raise MINIMUM_VERSION above the binary's self-reported version or the hook re-downloads on every command.

## Sequence
Task 0 (DONE 2026-10-09, Boss approved) · Task 1 (done) → Task 1b → Task 1c → Task 2 → Task 3 GREEN → Task 4 → Task 5 → /oss:ship (PR, Boss merges).
Version bump: plugin patch version per repo convention, so marketplace users pick the fix up.

## Estimated: 5 tasks (+1 ops), ~6 tests

## Ship fix round 1 (2026-10-09) — findings from /oss:ship quality gates (quality PASS, perf PASS, security PASS w/ 1 Medium)
- [x] F1 (sec M1) Download to a private temp file in ~/.oss/bin (0600), verify BOTH hashes on it, then chmod 755 + atomic `mv` over the final path. On any failure the old binary is untouched; trap removes the temp file. RED: fake curl records its `-o` target (must never be the final path) and serves bad bytes; an executable old binary must survive unchanged.
- [x] F2 (perf P3 / sec P2, pre-existing) curl `-fsSL --proto '=https' --connect-timeout 15 --speed-limit 1024 --speed-time 60` (stall-abort without capping total time for slow links). RED: recorded curl args include these flags for both downloads.
- [x] F3 (sec L2) Validate OSS_DECRYPT_TAG `^cli-decrypt-v[0-9]+\.[0-9]+\.[0-9]+$`; invalid → exit non-zero, no network call. RED: `OSS_DECRYPT_TAG=../../evil` makes no curl call and fails.
- [x] F4 (sec L1, quality I2/I3, perf) CI "Keep Latest" step: Latest = the exact tag pinned in hooks/ensure-decrypt-cli.sh (single source; checkout step, SHA-pinned), explicit ::error:: if it cannot be read, `timeout-minutes: 5`; no newest-release selection. Test greps non-comment lines only.
- [x] F5 (sec L4, quality I4) login.md calls `~/.oss/hooks/ensure-decrypt-cli.sh` in the allowlisted form; fallback `${CLAUDE_PLUGIN_ROOT}/hooks/…` only if it exists; explicit stop message if neither. Extend acceptance A2.
- [x] F6 (quality L3) Hook failure messages stop sending users to /oss:login "for manual installation" (login now runs this same hook): actionable text (check github.com access / update plugin and retry). RED: no hook failure output contains "manual installation".
- [x] F7 (quality L1) Test: manifest beside the hook (no plugin-root, no env seam) installs. Anti-vacuity: must go red with the beside-hook lookup mutated.
- [x] F8 (quality L2) Test the real committed manifest: exactly one 64-hex entry per oss-decrypt-{Darwin,Linux}-{arm64,x64}; header tag == hook's default OSS_DECRYPT_TAG.
- [x] F9 (quality I1) Test stubs report the real asset's self-version (v1.2.1); comment at MINIMUM_VERSION: must stay ≤ pinned binary's self-reported version.
- [x] F10 (perf) Session start must not chmod +x data files. RED: behavioural run in temp HOME asserts manifest copied and NOT executable.
- [x] F11 (sec I1) Unwired oss-session-start-new.sh / -test.sh copy lists: any HOOKS_TO_COPY containing ensure-decrypt-cli.sh must also contain the manifest (guard test).
- [ ] F12 (quality I5) PR body notes the unrelated archive move of model-frontmatter-routing.
### Deferred (with reason) — not changed in this PR
- sec P1 re-verify installed binary every run: hashes ~50 MB on EVERY /oss:* command and forces re-download for every customer whose binary ≠ v1.2.3 bytes → conflicts with Boss's "don't break existing customers". Proposal for a separate decision.
- sec L3 test seams (OSS_DECRYPT_CHECKSUMS/TAG, plugin-root) in production: accepted — requires same-uid/env control, which already allows replacing hooks or the binary directly (auditor's own assessment).
- sec P3 emit_oss_error same-uid trust; sec P4 in-release .sha256 kept as defence in depth: accepted, pre-existing.
