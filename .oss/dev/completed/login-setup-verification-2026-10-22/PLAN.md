# PLAN: Fix /oss:login false-positive "Setup Complete"

**Repo:** `one-shot-ship-plugin`
**Branch:** `feat/login-setup-verification/build` (cut from `origin/main`)
**Methodology:** London TDD — RED → GREEN → REFACTOR. Every code change starts failing.
**Created:** 2026-06-26

> ⛔ IRON LAW #4: branch off `main`, never push to main. Plugin repo, not AgenticDevWorkflow.

---

## Phase 1 — Verifier script `hooks/verify-decrypt-setup.sh` (TDD, bash harness)

New harness: `hooks/__tests__/verify-decrypt-setup.test.sh` (mirrors `ensure-decrypt-cli.test.sh`
helpers: temp `$HOME`, mock binaries). The verifier is the testable unit that gates "ready".

### Task 1 — RED: crashing binary ⇒ fail with its stderr
- Behavior: "A decrypt CLI that crashes on run is reported as NOT ready, surfacing its stderr."
- Test: mock `~/.oss/bin/oss-decrypt` that exits non-zero on `--version` printing
  `Cannot find module '/snapshot/dist/oss-decrypt.cjs'` to stderr; run verifier.
- Assert: exit ≠ 0, output contains the stderr text, output does NOT contain a success marker.
- RED proof: script doesn't exist yet → test fails.

### Task 2 — GREEN: implement the `--version` runnability check
- Create `hooks/verify-decrypt-setup.sh`: resolve `$OSS_DECRYPT`; run `--version` capturing
  stderr; on non-zero, print "Decrypt CLI is not runnable:" + stderr, exit 1. MINIMAL.

### Task 3 — RED: binary runs but no credentials.enc ⇒ fail
- Test: mock binary that succeeds on `--version`; ensure `~/.oss/credentials.enc` absent.
- Assert: exit ≠ 0, message names missing credentials / `--setup` not completed, no success.

### Task 4 — GREEN: add credentials.enc existence + non-empty check
- After the runnable check, fail unless `~/.oss/credentials.enc` exists and is non-empty.

### Task 5 — RED: binary runs AND creds present ⇒ success (exit 0)
- Test: working mock binary + non-empty `credentials.enc`.
- Assert: exit 0 AND output contains the success marker (e.g. "verified").
- (RED before Task 6 since success branch/message not written yet.)

### Task 6 — GREEN/REFACTOR: success message + tidy
- Print the success line, exit 0. Refactor for shared messaging; harness fully green.

**Files:** `hooks/verify-decrypt-setup.sh` (new), `hooks/__tests__/verify-decrypt-setup.test.sh` (new)

---

## Phase 2 — Wire `commands/login.md` to gate success on the verifier

### Task 7 — RED: login.md contract test
- New test (bash in `hooks/__tests__/` or vitest in `watcher/test/hooks/`) asserting:
  (a) login.md references `verify-decrypt-setup.sh`;
  (b) login.md no longer prints an install-success line guarded only by `[ -x …oss-decrypt ]`.
- RED proof: current login.md fails both.

### Task 8 — GREEN: edit login.md
- Replace the manual "Verify installation" block (lines ~265-273): run
  `~/.oss/hooks/verify-decrypt-setup.sh` and print the success banner ONLY on exit 0; on
  failure echo its output + "Run /oss:login again after resolving" (no success).
- Key-rotation step (lines ~107-113): gate the "Updated credentials" line on the verifier.
- Contract test green.

**Files:** `commands/login.md`, the new contract test.

---

## Phase 3 — Make `hooks/ensure-decrypt-cli.sh` message honest

### Task 9 — RED: hook must not claim "ready" when setup failed
- Extend `hooks/__tests__/ensure-decrypt-cli.test.sh`: mock binary that passes `--version`
  but whose `--setup` fails (and leaves no `credentials.enc`); run hook.
- Assert: output does NOT contain a bare "ready"/success for credentials; instead reflects
  setup-incomplete (binary still installed). RED against current line 189.

### Task 10 — GREEN: honest post-setup status
- After `--setup`, derive status from `verify-decrypt-setup.sh` (or inline creds check);
  print "ready" only when verified, else "installed — run /oss:login to finish credential
  setup". Keep install non-fatal / exit behavior unchanged. All existing hook tests stay green.

**Files:** `hooks/ensure-decrypt-cli.sh`, `hooks/__tests__/ensure-decrypt-cli.test.sh`

---

## Phase 4 — Ship

### Task 11 — Plugin version bump
- Bump `.claude-plugin/plugin.json` patch (2.0.74 → 2.0.75) to ship the corrected hook +
  login flow to users.

---

## Task → file → verified-by

| Task | Type | Files | Verified by |
|------|------|-------|-------------|
| 1 | RED | verify test.sh | harness: crash ⇒ fail+stderr |
| 2 | GREEN | verify-decrypt-setup.sh | runnable check |
| 3 | RED | verify test.sh | no-creds ⇒ fail |
| 4 | GREEN | verify-decrypt-setup.sh | creds check |
| 5 | RED | verify test.sh | all-good ⇒ success |
| 6 | GREEN | verify-decrypt-setup.sh | harness green |
| 7 | RED | login contract test | fails on current login.md |
| 8 | GREEN | login.md | contract test green |
| 9 | RED | ensure-decrypt test.sh | hook false "ready" caught |
| 10 | GREEN | ensure-decrypt-cli.sh | honest status; suite green |
| 11 | ship | plugin.json | 2.0.75 |

## Dependencies / sequencing
- Phase 1 first (verifier is the dependency for 2 & 3).
- Phases 2 and 3 both consume the verifier; can proceed in either order after Phase 1.

## Definition of done
- Verifier harness green; crash ⇒ surfaced stderr, no-creds ⇒ failure, healthy ⇒ success.
- login.md prints success ONLY when verifier passes; references it; key-rotation gated.
- ensure-decrypt-cli.sh never prints a false "ready" when creds absent.
- Full hook suites green; plugin 2.0.75.
- Re-running this against the v1.2.2-style crash would have FAILED login loudly (the bug
  this fixes).
