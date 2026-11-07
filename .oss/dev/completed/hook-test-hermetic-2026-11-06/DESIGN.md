# Design: Hook tests are hermetic; hook background jobs never hold the caller

## Origin
Found while gating log-rounds (2026-10-28): full `watcher/test/hooks` runs failed 1–5 tests each time, a different file each run, each passing alone. The user ruled flaky tests out of a customer ship. Two debugger agents traced root causes (evidence in session scratchpad `diag-a/`, `diag-b/`). Decisions (user, 2026-10-28): ship this first on its own branch, then log-rounds; scope = production fixes + root test-isolation fix in setup.ts + the 7 diagnosed tests.

## Production defects (customer-facing)
Hook callers (Claude Code, execSync in tests) wait for EOF on the hook's stdout/stderr, not for bash to exit. A background job that inherits stdio keeps the caller waiting.

| Site | Defect | Evidence |
|---|---|---|
| `hooks/oss-notify.sh:259-266` | every workflow `start` launches `( oss_api_curl … POST /api/v1/analytics/track … ) &` with NO `-m` and inherited stdio | stub curl sleeping 6 s → hook takes 6.7 s; 15 s → hits caller's 10 s cap |
| `hooks/oss-notify.sh:357-364` | background `( update_msg=$(check-updates.sh); [[ -n $update_msg ]] && sleep 11; … ) &` with inherited stdio | with an update notice pending, session start blocks ≥ 10 s (measured 10.011 s at the cap) |
| `hooks/oss-session-start.sh:341/347` | launches `oss-notify.sh … &` without detaching stdio, so the 11 s sleep above reaches session start | trace in diag-a |

Fix shape: detach every such background job (`</dev/null >/dev/null 2>&1` on the subshell) and bound network calls (`-m`). IRON LAW #1b: grep all of `hooks/` for background jobs (`) &`, `… &`) that inherit stdio, and for curl calls without a time bound; fix every site or state why it is safe.

## Test defects
1. **First exec of a freshly written executable (macOS `syspolicyd`/XProtect).** Every new file runs a security check on first exec: 0.3–0.5 s idle, serialized machine-wide, growing with concurrent creators (8 → median 3.5 s, max 14.9 s; one stall > 4 min). Second exec 0.01 s; `bash file` 0.01 s. Tests that write stubs and run them inside a time budget are unbounded. Affected: `oss-notify-telegram.test.ts` (fake node + oss-log.sh stubs per test), `hook-error-adoption.test.ts` (`stubCurl` per test, also the ensure-decrypt-cli cases), `hooks/__tests__/oss-notify-complete-bounds.test.sh` (node + oss-log.sh stubs per case; already warms its `sleep` stub at line 92), `hooks/__tests__/oss-api-curl.real.integration.test.sh` (new curl shim before an 8×0.15 s `ps` sampling window).
   Fix shape: create stubs once per file and warm them outside any timed section, or avoid exec of new files (`bash stub`, exported bash functions); replace wall-clock asserts with behavior (recording timeout stub, event-driven `received`/`release` files instead of sampling windows).
2. **Real HOME / real network / shared state.**
   - `oss-notify-project.test.ts`: real HOME with a real apiKey → each run POSTs a real analytics event to production and waits on it; reads parent `CLAUDE_CODE_SESSION_ID`.
   - `oss-session-logging.test.ts`: real HOME, real network (`oss-session-start.sh:142`, `check-updates.sh:84`); session-end runs `oss_session_pointer_remove "$CLAUDE_CODE_SESSION_ID"` (`oss-session-end.sh:18`) → deletes the LIVE session's project pointer; start overwrites `~/.oss/plugin-root`, `~/.oss/hooks/*`; 1,526 lines of test noise in the real session.log; session-end tests keep vitest's 5 s budget.
   - `oss-log-error-recovery.test.ts`: execSync inherits real HOME, cwd `os.tmpdir()` → writes fixture lines into real `~/.oss/logs/current-session/{build,plan,ship}.log` (30/45/15 lines found); restores only session.log; overwrites real current-project.
   - `watcher/test/setup.ts`: deletes the real `~/.oss/current-project` before every test; `pkill -f "oss-session-start"` / `health-check.js` and `watcher.pid` deletion machine-wide (kills other sessions' runs and real hooks). 16 of 31 hooks test files build paths from `os.homedir()`.
   Fix shape: setup.ts points `HOME` (and so `os.homedir()`) at a per-run temp dir and strips `CLAUDE_CODE_SESSION_ID`/`CLAUDE_PROJECT_DIR`; it kills only processes it started (or nothing); each diagnosed test uses its own sandbox HOME with no apiKey (or a stub curl) and asserts on sandbox files.

## Non-goals
- The dead analyzer/push-metrics pipeline (FOLLOWUPS on the log-rounds branch).
- Rewriting the other 14 real-HOME test files individually: the setup.ts HOME redirect covers them; any that break under it are fixed as found.

## Last Updated: 2026-10-28 by orchestrator (from diag-a/diag-b reports)
