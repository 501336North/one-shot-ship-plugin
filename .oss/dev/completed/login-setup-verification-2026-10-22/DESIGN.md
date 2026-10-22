# DESIGN: Fix /oss:login false-positive "Setup Complete"

**Repo:** `one-shot-ship-plugin` (login is a clear-text bootstrap command; NO API-served copy
exists — verified, so scope is plugin-only).
**Status:** Planned
**Created:** 2026-06-26

## Problem

`/oss:login` declared setup successful even though the `oss-decrypt` binary **crashed** and
`--setup` never generated `credentials.enc`. This masked the v1.2.2 arm64 packaging crash
(`Cannot find module '/snapshot/dist/oss-decrypt.cjs'`) for a full release cycle — the user
saw "Setup Complete 🎉" while nothing was actually configured.

There are **two** false-positive surfaces:

1. **`commands/login.md` manual-install path (primary):**
   - Step 3 (line 257) runs `oss-decrypt --setup` with **no exit-status check**.
   - Step 4 "Verify installation" (lines 265-273) checks only
     `[ -x ~/.oss/bin/oss-decrypt ]` — i.e. *the file is executable*, NOT that it RUNS,
     NOT that `--setup` succeeded, NOT that `credentials.enc` exists. A binary that is
     executable but crashes on run passes → "CLI installed successfully".
   - The key-rotation path (lines 107-113) has the same `[ -x ]`-then-`--setup`-no-check shape.

2. **`hooks/ensure-decrypt-cli.sh` (secondary):**
   - Correctly checks `--version` runs (line 173, deletes a bad binary) — so the *auto*-hook
     would have caught v1.2.2. BUT it then swallows `--setup` failure (lines 183-186,
     "Don't exit with error") and still prints `oss-decrypt CLI v… ready.` (line 189). So the
     hook itself reports "ready" when credentials were never generated.

The broken binary reached the user via path #1 (manual install only checks `[ -x ]`).

## Goal

`/oss:login` (and the auto-hook) declare success **only** when the decrypt CLI is genuinely
functional: the binary RUNS and `credentials.enc` exists. On failure, surface the binary's
actual stderr (e.g. the `Cannot find module` crash) and a clear next step — never a success
banner.

## Approach

### 1. New shared verifier: `hooks/verify-decrypt-setup.sh`
A small, side-effect-free, TDD-able script. Exit 0 = genuinely ready; non-zero = not ready.
```
1. Binary runs:  "$OSS_DECRYPT" --version  (capture stderr)
     fail → print "Decrypt CLI is not runnable" + the captured stderr → exit 1
2. Creds exist:  ~/.oss/credentials.enc present AND non-empty
     fail → print "Credentials not generated — `--setup` did not complete" → exit 1
3. all pass   → print "✅ Decrypt CLI verified: binary runs and credentials configured" → exit 0
```
This is the single source of truth for "is login actually done". It is a pure check (does
NOT run `--setup` itself), so callers run `--setup` then verify the result.

### 2. Wire `commands/login.md`
- Manual-install "Verify installation" step: replace the `[ -x ]`-only block with a call to
  `~/.oss/hooks/verify-decrypt-setup.sh`; print the success banner **only** if it exits 0,
  else print the failure it emitted and stop (no success).
- Key-rotation step: after `--setup`, gate the "Updated credentials" line on the verifier.

### 3. Make `hooks/ensure-decrypt-cli.sh` honest
After `--setup`, replace the final unconditional `… ready.` with a verifier-backed status:
binary stays installed (install is non-fatal as today), but the message reflects whether
credentials are configured — never a false "ready". (Keep hook exit code behavior so the
auto-install UX is unchanged; the message is what gets corrected.)

## Out of scope
- Making the auto-hook hard-fail on missing creds (would break the "install now, setup on
  first command" UX). Only the **message** is corrected; login is where the user-facing
  success claim is gated.
- Re-architecting `--setup` itself (binary behavior unchanged).

## Testability
- `verify-decrypt-setup.sh` → bash harness (mirrors `ensure-decrypt-cli.test.sh`): mock a
  crashing binary, a working binary with/without `credentials.enc`.
- `login.md` wiring → grep-contract test (assert it calls `verify-decrypt-setup.sh` and no
  longer declares success on `[ -x ]` alone).
- `ensure-decrypt-cli.sh` honest message → extend its existing harness.
