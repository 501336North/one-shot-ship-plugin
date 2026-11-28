# Plan: merged-hints-flake

Last Updated: 2026-11-28 10:00 +07 by orchestrator (directed by OSS DETERMINISTIC, owner's go)

## Problem
`watcher/test/cli/phase-result-merged-hints.test.ts` fails 2/4 under machine load (~30): "gh logged out" and "HTTP 404".
The test calls the CLI's `main()` in process. `main()` starts complete's one 9 s budget (phase-result.ts:515, MERGED_BUDGET_MS),
shared by every git call and the stub gh through wall-clock `Date.now()` (merge-ready.ts `git()` and `prMerged`). Under load the
budget runs out, the stub gh is killed (spawnSync timeout = what is left), and the check answers `gh_unreachable`, not the
cause-specific hint the test asserts.

## Constraints (coordinator)
- Fix the root cause so the test does not depend on load. Never retry. Never loosen the product budget (MERGED_BUDGET_MS, the
  9 s in main()) without asking the coordinator.
- Targeted tests only, temp HOME; no heavy load (R-259 load proof running).

## Task 1: the merged-hints tests cannot be outrun by load
- RED: make the dependence on wall time deterministic and visible. In the test file, simulate a slow machine (for example a
  `Date.now` that jumps past the budget after the first reads, or the equivalent); the "gh logged out" and "HTTP 404" cases then
  fail with the gh_unreachable/"when online" wording, exactly as under load.
- GREEN (minimal, test-side): the test owns the clock for `main()` (for example `vi.spyOn(Date, 'now')` returning a fixed time,
  so `deadline - Date.now()` stays the full budget and each spawn gets it as its timeout), so real elapsed time can no longer
  spend the budget. No change to src/ unless a test-only seam is unavoidable; if one is, stop and report before adding it.
- Keep: all 4 cases assert the same behaviour as before (no assertion weakened); the budget tests elsewhere
  (phase-result deadline tests) still pass.
- Verify: `npx vitest run test/cli/phase-result-merged-hints.test.ts` (temp HOME) 4/4, and the deadline/merged-ready test files.

## Out of scope
- Product budget values; other flaky files (report any seen).
