# Progress: hook-test-hermetic

## Current Phase: build (started 2026-10-29; acceptance tests GREEN and committed with T3)

## Tasks
- [x] T1: Analytics POST on workflow start is detached and time-limited (completed 2026-10-29)
- [x] T2: A pending update notice never holds session events (completed 2026-10-29)
- [x] T3: Session start launches notify detached (completed 2026-10-29)
- [x] T4: Provenance sweep of background jobs and unbounded curls in hooks/ (completed 2026-10-29: 4a oss-log agent, 4b health check, 4c log fallback, 4d login -m; 4e pipefail jq exits moved to FOLLOWUPS by user decision)
- [x] T5: setup.ts sandboxes HOME and kills nothing it did not start (completed 2026-10-29)
- [x] T6: Fix the tests that break under the sandboxed HOME (completed 2026-10-29: 6.a .oss in sandbox HOME, 6.b session-context-local, 6.b2 restore test, 6.c = T11; plus 4a-2 agent-status-line race)
- [x] T7: Warm-stub helpers in TS and bash (completed 2026-10-29)
- [ ] T8: oss-notify-telegram.test.ts: stubs made once and warm (pending)
- [x] T9: hook-error-adoption.test.ts: one env-driven curl stub (completed 2026-10-29)
- [ ] T10: oss-notify-project.test.ts made hermetic (pending)
- [x] T11: oss-session-logging.test.ts made hermetic, live session safe (completed 2026-10-29 as T6.c)
- [ ] T12: oss-log-error-recovery.test.ts writes only in its sandbox (pending)
- [ ] T13: complete-bounds.test.sh checks boundedness, not wall-clock (pending)
- [ ] T14: api-curl.real.integration.test.sh is event-driven (pending)
- [ ] T15: Stability proof: 5 runs each, plus a run under load (pending)
- [ ] T16: Version bump to 2.0.95 and the server analytics follow-up (pending)

## Blockers
- None

## Last Updated: 2026-10-29 11:22 CST by /oss:build (full suite 3570/3570; next T8, T10, T12-T14)
