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

### /oss:acceptance (RED), 2026-11-27
- **Shell:** `hooks/__tests__/complete-gaps.acceptance.test.sh`, run as `env -i … HOME=$(mktemp -d) /bin/bash <file> </dev/null`. `scripts/run-shell-tests.sh` is not on this branch (it is main-only, #227), and it takes a folder, which would include oss-notify-phase-result.test.sh.
  - 13 ran, 9 failed for the right reason: a1–a3 give `no_feature` (the lookup is ship-only); b1, b2, b5 and b6 have no legacy row, so complete refuses `missing results/ship.json`.
  - 4 guards already pass (b3 skipped start or post-marker start; b4 results in the repo or ledger). These refusals are today's behaviour, and the guards keep the legacy branch from passing too much.
- **Watcher:** `cd watcher && npx vitest run test/guard/real-home.test.ts` gives `Cannot find module '../global-setup'` (RED; 4 cases planned).
- Re-run by the orchestrator gave the same counts. The real ~/.oss hooks, config and ledger were unchanged.
- Note for Task 4: check row order by position in the ledger, not by time (a second `ship start` can keep the old `currentCommandStartedAt`).
- The RED tests are left uncommitted (no commit with failing tests); they go in with the GREEN work in /oss:build.

### /oss:build (GREEN), 2026-11-27
Each shell file run on its own as `env -i … HOME=$(mktemp -d) /bin/bash <file> </dev/null`; watcher files with `npx vitest run <files>` under the repo config. Every task saw its RED first.

| File | Result |
|---|---|
| hooks/__tests__/complete-gaps.acceptance.test.sh | 13/13 (a1–a3, b1–b6) |
| hooks/__tests__/legacy-since-marker.test.sh (new, Task 3) | 6/6 |
| hooks/__tests__/legacy-row.test.sh (new, Task 4) | 11/11 |
| hooks/__tests__/legacy-complete.test.sh (new, Task 5 + D8 same-feature rule) | 12/12 |
| hooks/__tests__/timeline-gate-archived.test.sh (new, Task 2b) | 6/6 |
| hooks/__tests__/phase-results.acceptance.test.sh (regression D84–D88) | 39/39 |
| hooks/__tests__/timeline-*.test.sh (12 files, regression) | all pass |
| watcher test/phase-results/build-archived.test.ts (new, Task 2) | 3/3 |
| watcher test/guard/real-home.test.ts (Task 6, + unset-HOME case) | 5/5 |
| watcher phase-result acceptance, recheck, merged-hints, deadline, dist, merge-ready | 134/134 |
| watcher test/hooks/oss-session-logging.test.ts (11-24 incident file) | passes |
| `tsc --noEmit` | clean |

- a3 needed its setup fixed to record gate rounds as a real ship does (D7); no assertion changed.
- Real ~/.oss checked before and after: config.json mtime and the 21 hook files unchanged.
- Not tested: a fork inheriting the temp HOME with `setupFiles: []` (needs a custom config, which the rules forbid); that bypass stays on card 3.

### /oss:integration, 2026-11-27
| Mock / seam | Where | Real check | Result |
|---|---|---|---|
| `mergedReady` (merge-ready → gh) mocked, expected never called on the build path | build-archived.test.ts | Ran acceptance case a1 (real bundled CLI, real hooks, real git) with a gh stub that logs every call. The log was cleared after the archive commit and read after the build fix round. A control call proved the log works. | 0 gh calls during build: matches the mock |
| `test -O` overridden through BASH_ENV for foreign-owner cases | legacy-*, timeline-gate-archived | Every positive case runs without the seam, so the real `test -O` passes on owned dirs and files | matches |
| foreign owner for real | — | Needs a second uid (sudo/chown), not available in tests | known limit; only the seam covers it |
| oss-value.sh removes exported functions, so the seam can't reach oss-value | timeline-gate-archived | That test calls oss-timeline.sh directly for the foreign case, and checked the case fails when `test -O` is removed | covered |

Probe script (not committed): `/private/tmp/claude-501/-Users-ysl-dev/d42aa2d9-ec5e-420e-ad83-58e63cad8053/scratchpad/gh-probe.sh`. No mismatches.

## Last Updated: 2026-11-27 18:55 +07 by /oss:integration
