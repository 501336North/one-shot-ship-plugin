# Testing: hook-test-hermetic

## Strategy
- **Not blocking the caller:** proven with received/release files and the `close` event (EOF on all pipes). Never with wall-clock thresholds. Time limits are only backstops against hangs.
- **Hermeticity:** proven with sentinels in a parent-provided HOME that must survive unchanged, plus recording stubs that must see zero network calls.
- **Anti-vacuity:** each new guard is shown RED against a mutant of the code it protects. The result is recorded below per task.
- **Safe runs until T5:** use the untracked safe vitest config (no setupFiles). After T5, use the real config.

## Results

### Acceptance (2026-10-28, /oss:acceptance, test-engineer)
File: `watcher/test/hooks/acceptance/hook-background-detach.acceptance.test.ts`. It has 4 tests across 3 scenarios, is hermetic and event-driven, and warms its stubs in beforeAll.

**On current code:** 4/4 RED, each because the hook kept its output open. A rerun by the orchestrator confirmed it.
- Workflow start: output stays open while the analytics request is in flight.
- Session event: output stays open while the update notice is pending (the delay job was reached).
- Session start, fresh start: output stays open while notify runs.
- Session start, context restored: output stays open while notify runs.

**Anti-vacuity:** with all four redirects in place, 4/4 GREEN. With only two of them, exactly the matching two turn GREEN. The hooks were then restored, and `git diff hooks/` is empty.

**Committed with T3 (2026-10-29), 4/4 GREEN.**

**Observed during warm-up:** one first exec of a new stub took 19.4 s at load average 9. That confirms DESIGN test defect 1.

### T1 (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-notify-analytics-detach.test.ts`, 3 tests.
- RED on current code: 2 failed for the right reason. Output was still open 15 s after the request started, and the analytics curl argv had no `-m`. The control (event still sent) passed.
- GREEN: 3/3. The acceptance "workflow start" test now passes; the other 3 acceptance tests stay RED (T2, T3).
- Anti-vacuity: reverting the redirect turns only test 1 RED; removing `-m 5` turns only test 2 RED.
- Whole hooks dir (safe config): 173/177. Failures: the 3 acceptance tests for T2/T3, and `oss-session-logging` "should log hook START event for session start" (6.7 s, a known flake, fixed by T11).

### T2 (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-notify-update-notice-detach.test.ts`, 2 tests.
- RED: test 1 failed because the output was still open 15 s after the notice delay started. It checks first that the delay was reached, so it cannot pass vacuously. The control (notice still posted after release) passed.
- GREEN: 2/2. Acceptance: "workflow start" and "session event" now pass; the 2 session-start tests stay RED (T3).
- Anti-vacuity: reverting the redirect turns test 1 RED with the same message.
- Whole hooks dir (safe config): 177/179. The only failures are the 2 T3 acceptance tests.
- **Watch in T15:** in that full run, the acceptance "fresh start" test failed at its launch check (line 355) after the 20 s marker backstop, not at the close check. Run alone, it fails at the close check as expected. If this recurs after T3, the backstop is load-sensitive and needs fixing.
- The helpers (`writeStub`, `warm`, hermetic env, `startHook`) are now copied in 3 files. T7 is where they get shared.

### T3 (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-session-start-notify-detach.test.ts`, 4 tests (2 branches × close + control).
- RED: both "finish starting" cases failed: output still open 15 s after the notify launch. Controls passed.
- GREEN: 4/4. Acceptance file: 4/4.
- Anti-vacuity: reverting the context_restored redirect turns only that case RED; the same holds for fresh_start.
- REFACTOR: the acceptance MARKER_BACKSTOP_MS went from 20 s to 60 s, and TEST_TIMEOUT_MS from 40 s to 100 s (load-sensitive launch wait seen in the T2 run). No assertion changed.
- Whole hooks dir (safe config): 182/183. The one failure was `hook-error-adoption` "should emit OSS-AUTH-001 ... 401", a known flake that T9 fixes.

### T4c (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-notify-log-fallback.test.ts`, 2 tests.
- RED: when there is no oss-log.sh and no plugin cache, the hook exited 1 silently before `setActiveStep build` (no node calls). The control, with oss-log.sh in the cache, passed.
- GREEN: 2/2. Anti-vacuity: removing `|| true` turns test 1 RED with the same message. Together with the T1 and T2 files: 7/7.

### T4b (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-session-start-health-check-detach.test.ts`, 2 tests.
- RED: (1) session start stayed open 15 s into the health check; (2) health-check.log had no summary, which went to the hook's stdout instead.
- GREEN: 2/2. Anti-vacuity: reverting the redirect turns only test 1 RED; reverting `>> health-check.log` turns only test 2 RED.
- Regression check: the notify-detach file and the acceptance file both pass (10/10).

### T4a (2026-10-29, /oss:build, test-engineer)
File: `watcher/test/hooks/oss-log-agent-detach.test.ts`, 5 tests: 4 variants (starting or completed, each with and without a project dir) plus a control.
- RED: all 4 variants were still open 15 s into the state update. Each also confirms it reached its intended branch. The control passed.
- GREEN: 5/5, 16 runs in a row including parallel runs. The orchestrator then reran it together with oss-log-agent-state 3 times: 10/10 each time.
- Anti-vacuity: reverting each of the 4 redirects alone turns exactly its own variant RED. A partial mutant (stdin and stdout redirected, no `2>&1`) is also RED.
- **The fix broke one existing test, and it was fixed:** `oss-log-agent-state` "should set supervisor to watching when agent completes" failed 3/3 with the fixed hook and passed 3/3 at HEAD. That test only passed because the hook blocked: it read `supervisor` after `clearActiveAgent` and before `setSupervisor`. It now waits for `supervisor === 'watching'`.
- **Unexplained, recorded:** the first GREEN run had 1 failure at 217 ms, and its message was not captured. It did not recur in 16 later runs. The likely cause is that `afterEach` deleted the state dir while the detached node chain was still writing to it. afterEach now waits for both node calls to finish (`node-done`). T15 must confirm this.
- **Same race, not yet fixed:** `oss-log-agent-state` "should still write to log file..." deletes its project dir while a real detached node chain may still be running. Added to T6.

## Stability proof (T15)
(5 runs per suite, plus 1 run under load, plus the real ~/.oss mtime check)

## Last Updated: 2026-10-28 by /oss:plan
