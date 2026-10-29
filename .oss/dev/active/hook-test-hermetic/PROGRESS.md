# Progress: hook-test-hermetic

## Current Phase: build complete (ready for /oss:ship)

## Tasks
- [x] T1: Analytics POST on workflow start is detached and time-limited (completed 2026-10-29)
- [x] T2: A pending update notice never holds session events (completed 2026-10-29)
- [x] T3: Session start launches notify detached (completed 2026-10-29)
- [x] T4: Provenance sweep of background jobs and unbounded curls in hooks/ (completed 2026-10-29: 4a oss-log agent, 4b health check, 4c log fallback, 4d login -m; 4e pipefail jq exits moved to FOLLOWUPS by user decision)
- [x] T5: setup.ts sandboxes HOME and kills nothing it did not start (completed 2026-10-29)
- [x] T6: Fix the tests that break under the sandboxed HOME (completed 2026-10-29: 6.a .oss in sandbox HOME, 6.b session-context-local, 6.b2 restore test, 6.c = T11; plus 4a-2 agent-status-line race)
- [x] T7: Warm-stub helpers in TS and bash (completed 2026-10-29)
- [x] T8: oss-notify-telegram.test.ts: stubs made once and warm (completed 2026-10-29)
- [x] T9: hook-error-adoption.test.ts: one env-driven curl stub (completed 2026-10-29)
- [x] T10: oss-notify-project.test.ts made hermetic (completed 2026-10-29)
- [x] T11: oss-session-logging.test.ts made hermetic, live session safe (completed 2026-10-29 as T6.c)
- [x] T12: oss-log-error-recovery.test.ts writes only in its sandbox (completed 2026-10-29)
- [x] T4f: keyed calls use the configured apiUrl and its key (completed 2026-10-29: session start 478b804, T4f-2 a12e1d6, T4g 256f262 49bd0fc 3cfeaf9 e06d4d3)
- [x] T4h: optional-helper-source and oss-notify-api-url wait for the detached analytics POST (regression from T1) (done 2026-10-29, test-engineer, not via a /oss:build invocation; e70b389, 9e1a0da)
- [x] T4i: fetch-iron-laws.sh's curl gets a time limit (found in T4g) (done 2026-10-29, test-engineer, not via a /oss:build invocation; e70b389, 9e1a0da)
- [x] T13: complete-bounds.test.sh checks boundedness, not wall-clock (completed 2026-10-29)
- [x] T13b: complete-bounds parses under /bin/bash 3.2 (completed 2026-10-29)
- [x] T14: api-curl.real.integration.test.sh is event-driven (completed 2026-10-29)
- [x] T15: Stability proof: 5 runs each, plus a run under load (completed 2026-10-29: watcher 5/5 + load before T15b; shell 5/5 + load after T15b/T15c, test-engineer)
- [x] T15b: oss-notification-style (and stop-telegram-style) wait for the popup, not a 2 s window (completed 2026-10-29, test-engineer)
- [x] T15c: negative checks after background jobs wait for the job, not sleep 1 (completed 2026-10-29, test-engineer)
- [x] T16: Version bump to 2.0.95 and the server analytics follow-up (completed 2026-10-29: plugin.json 2.0.95, the only pin; FOLLOWUPS analytics item)
- [x] T17: session start never downgrades the shared ~/.oss/hooks (completed 2026-10-29, test-engineer, via /oss:build)

## Blockers
- None

## Last Updated: 2026-10-29 19:48 CST by /oss:build (T17 done via a fresh invocation; watcher 265/265 files, 3578 tests; shell 53/53 files)
