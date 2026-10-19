# Plan: wrapper-complete-status

## Summary
23 plugin command wrappers (a11y found by the RED test, in addition to the 22 listed) send `oss-notify.sh --workflow <cmd> start` and never `complete`, so the status line never shows done for them (FOLLOWUPS 76). Each gets a fixed `complete '{}'` step at its end. The JSON is fixed, so no model value enters the shell.

The wrappers are: audit, bench, chaos, cost, deploy, docs, experiment, feature-flag, incident, license, load, monitor, postmortem, privacy, release, retro, rollback, smoke, stage, tech-debt, test, trace.

Note: FOLLOWUPS 75 (the ship wrapper never sending `complete`) was already fixed by #193 (v2.0.86); it was stale.

## Tasks
- [ ] **T1 (RED → GREEN):** `commands/__tests__/wrapper-complete.test.sh`
  - Fails if any `commands/*.md` that sends `--workflow <w> start` has no `--workflow <w> complete` (or `merged`) line for the same `<w>`.
  - Fails if any added `complete` line carries a `{…}` placeholder.
  - RED: lists the 22 above.
  - GREEN: add a "Status Line (Completion)" step with exactly `~/.oss/hooks/oss-notify.sh --workflow <w> complete '{}'` before the Error Handling section of each wrapper. Use a count-checked script that must change exactly 22 files.
- [ ] **T2:** version 2.0.89. Run all of `commands/__tests__` and `hooks/__tests__`, and the whole `watcher/test/hooks` folder (no-setup config, `CLAUDE_PROJECT_DIR` unset).

## Last Updated: 2026-10-19 by /oss:plan (boss session)

## Ship round 1 findings (2026-10-19), all fixed in this round

### Track A: wrappers and test (commands/)
- [x] **F1 (HIGH, code-reviewer):** the completion step is unconditional. On a failed run the served prompt sends `failed`, then the wrapper sends `complete`, which overwrites the failure, clears `intervening` and can fire chains.
  - Fix: make the section say exactly: "On success only. If the command failed (the prompt sent `failed`), do not send `complete`." (same intent as review.md and ship.md).
  - Test: each of the 23 completion sections contains that guard sentence.
- [x] **F2 (MEDIUM, code-reviewer):** in 19 files the step sits at the end of the file, after the reference sections.
  - Fix: move it so it comes directly after the "Execute the Fetched Prompt" step.
  - Test: the completion section is the first `##` heading after the Execute heading, and its line is inside a ```bash fence.
- [x] **F5 (LOW ×2, code-reviewer):**
  - Test 1 now matches the notify path anywhere on the line (`~/.oss/hooks/` or `$HOME/.oss/hooks/`, any indent).
  - It asserts a floor on wrappers with a start (≥ 54 today).
  - Test 2 checks placement (F2).
- [x] **F9 (INFO, code-reviewer, pre-existing):** load, smoke, tech-debt and trace have an empty "Execute the Fetched Prompt" step. Give it the one-line body the other wrappers use.
- [x] **F13 (INFO, code-reviewer):** TESTING.md records the wrong-name and placement mutations as killed.

### Track B: notifier and watcher
- [x] **F3 (MEDIUM, performance-engineer; also covers security LOW and pen-test LOW):** `complete` spawns chain-trigger for workflows that can never chain. Each one makes an authenticated GET that is always a 404 and can block for up to 8 s.
  - Fix in `watcher/src/cli/chain-trigger.ts`: return early with no fetch and no output when the workflow is not a key of `DEFAULT_WORKFLOW_CONFIGS`. That list is the single source; provenance: the API `WORKFLOW_NAMES` is the server twin, and both must name exactly ideate, plan, build and ship.
  - Test (vitest): chain-trigger for `audit` makes no fetch and prints nothing; for `build` it still fetches.
  - Rebuild dist, including `chain-trigger.cjs`.
- [x] **F4 (MEDIUM, performance-engineer, pre-existing):** the Telegram send has no timeout.
  - Fix: wrap it in `run_with_timeout` in `oss-notify.sh`, and add `AbortSignal.timeout` to the fetch in `telegram-notify.ts`.
  - Tests: a bash test with a stalled Telegram stub returns within the bound; a vitest that the fetch passes a signal.
- [x] **F6 (LOW, performance-engineer, pre-existing):** `run_with_timeout` sends stderr to /dev/null, so `chain-trigger.log` is always empty.
  - Fix: keep stderr so the caller's `2>>` redirect works.
  - Test: a chain-trigger "No API key" message lands in the log.
- [x] **F7 (LOW, performance-engineer):** the 4 workflow-state status lines on `complete` cost tokens.
  - Run the provenance check first: grep tests and prompts that read "Step completed" etc.
  - If nothing depends on them, silence them on `complete`. Otherwise record no-change with the reason.
- [x] **F8 (LOW, performance-engineer):** the 4 sequential `wf_state` spawns on `complete` have no timeout. Fix: use `wf_state_timeout`.
- [x] **F10 (INFO, pen-test, pre-existing):** `update-workflow-state` prints "Step completed" even when the guard refused the write.
  - Fix: on refusal, print the refusal and exit non-zero, and do not print the success line.
  - Test: vitest/bash with a symlinked state file.

### No change needed (recorded)
- **pen-test INFO:** hostile committed `workflow-state.json` content persists, but it is never printed by `complete`. It is a display-only path to the user.
- **pen-test INFO:** the installed hook is inert without the plugin cache. This is expected on real installs; verify after deploy.
- **security INFO:** the checklist `grep -r` runs over the cwd. It is read-only and writes only to a log.

## Ship round 2 findings (2026-10-19), user: "fix it now"
- [x] **R2-1 (MEDIUM, matters, performance R2):** the fallback `run_with_timeout` path (no `timeout`/`gtimeout`, i.e. stock macOS) leaves the killer's `sleep` holding the hook's stdout and stderr open, so a pipe reader waits about 33 s on every `complete`. The same change also fixes:
  - **LOW:** orphan `sleep` processes pile up;
  - **LOW:** a `Terminated: 15` job notice reaches stderr;
  - the 3 s copy-service `$(...)` hold.
  - **Fix:** run the killer as `( sleep N && kill -9 $pid ) >/dev/null 2>&1 &`, kill its `sleep` with the subshell, and `wait` the killer quietly.
  - **Test:** a case in `oss-notify-complete-bounds.test.sh` with a PATH hiding `timeout`/`gtimeout`, reading stdout through a pipe with a time bound (< 5 s for audit `complete`), asserting no `Terminated` on stderr and no leftover `sleep` from this run. It is RED today (about 33 s).
