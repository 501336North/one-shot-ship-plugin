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

**Not committed yet:** these tests must not land RED. They are committed with T1–T3, when they turn GREEN.

**Observed during warm-up:** one first exec of a new stub took 19.4 s at load average 9. That confirms DESIGN test defect 1.

## Stability proof (T15)
(5 runs per suite, plus 1 run under load, plus the real ~/.oss mtime check)

## Last Updated: 2026-10-28 by /oss:plan
