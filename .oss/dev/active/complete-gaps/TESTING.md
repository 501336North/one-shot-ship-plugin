# Testing: complete-gaps

## Strategy
- Targeted tests only, each with a temp HOME: the repo's own watcher `vitest.config.ts` (`test/setup.ts`, sequential forks), and `scripts/run-shell-tests.sh` (an empty HOME per test).
- Never the full watcher suite, never `oss-notify-phase-result.test.sh`, never `setupFiles: []` with the real HOME.
- Regression check: `hooks/__tests__/phase-results.acceptance.test.sh` (D84–D88 cases 13a–13f).

## Planned files
- `hooks/__tests__/complete-gaps.acceptance.test.sh` (Task 1)
- `hooks/__tests__/legacy-since-marker.test.sh` (Task 3)
- `watcher/test/phase-results/build-archived.test.ts` (Task 2)
- `watcher/test/guard/real-home.test.ts` (Task 6)

## Results
None yet (plan phase).

## Last Updated: 2026-11-27 17:30 +07 by /oss:plan
