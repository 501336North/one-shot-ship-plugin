# Progress: hook-test-hermetic

## Current Phase: build (started 2026-10-29; acceptance tests uncommitted until T1-T3 turn them GREEN)

## Tasks
- [x] T1: Analytics POST on workflow start is detached and time-limited (completed 2026-10-29)
- [ ] T2: A pending update notice never holds session events (in progress)
- [ ] T3: Session start launches notify detached (pending)
- [ ] T4: Provenance sweep of background jobs and unbounded curls in hooks/ (pending)
- [ ] T5: setup.ts sandboxes HOME and kills nothing it did not start (pending)
- [ ] T6: Fix the tests that break under the sandboxed HOME, one cycle per file (pending)
- [ ] T7: Warm-stub helpers in TS and bash (pending)
- [ ] T8: oss-notify-telegram.test.ts: stubs made once and warm (pending)
- [ ] T9: hook-error-adoption.test.ts: one env-driven curl stub (pending)
- [ ] T10: oss-notify-project.test.ts made hermetic (pending)
- [ ] T11: oss-session-logging.test.ts made hermetic, live session safe (pending)
- [ ] T12: oss-log-error-recovery.test.ts writes only in its sandbox (pending)
- [ ] T13: complete-bounds.test.sh checks boundedness, not wall-clock (pending)
- [ ] T14: api-curl.real.integration.test.sh is event-driven (pending)
- [ ] T15: Stability proof: 5 runs each, plus a run under load (pending)
- [ ] T16: Version bump to 2.0.95 and the server analytics follow-up (pending)

## Blockers
- None

## Last Updated: 2026-10-29 07:49 CST by /oss:build (T1)
