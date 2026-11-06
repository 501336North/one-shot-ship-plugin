# Testing: Radical Observability G2, Phase B (plugin)

## Strategy
- Outside-in: `hooks/__tests__/timeline.acceptance.test.sh` first. It runs the real hooks with a fake `curl` (`fake-oss-api.sh`) and a fake `gh` only.
- Unit tables per task (see PLAN.md), each a hermetic bash test file:
  - sandbox HOME, GIT_* unset, `GIT_CONFIG_GLOBAL=/dev/null`;
  - `unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK`;
  - caps only through `run_capped`.
- Cross-repo contract: each pushed body is checked against a jq copy of the API's strict schema (exact key sets per kind).

## How to run
- One file at a time, for example `/bin/bash hooks/__tests__/timeline-writer.test.sh`.
- Also run the guards each task touches: `hooks-registration`, `tests-hermetic-env`, `one-copy-helpers`, `no-hand-capped-tests`, `oss-writer-nofollow`, plus G1's `decision-record.acceptance`, `oss-decision-record` and `decision-push` after Task 2.
- **Never** run the watcher's vitest suite: its setup kills OSS processes machine-wide.

## Results
- 2026-11-06 `/oss:acceptance`: `timeline.acceptance.test.sh` 8 run, 8 failed (expected: nothing built yet). The fake API gained a `/api/v1/timeline` route (queue `timeline`, 201 default); G1's `decision-record.acceptance` (5/5) and `decision-push` (100/100) still pass. Guards: `tests-hermetic-env` 90/90, `no-hand-capped-tests` 35/35.
- 2026-11-06 `/oss:build` Task 2: `feature-resolve.test.sh` 8 run, 0 failed (RED first: 8 of 8 failed, `oss_resolve_feature: command not found`). G1 unchanged and green: `decision-record.acceptance` 5/5, `oss-decision-record` 111/111, `decision-push` 100/100. Guards: `hooks-registration` 25/25, `tests-hermetic-env` 91/91, `one-copy-helpers` 12/12, `no-hand-capped-tests` 35/35, `oss-writer-nofollow` 49/49, `oss-state-files-nofollow` 20/20, `referenced-hooks-tracked` 45/45, `bash32-parse` 134/134. Every other file that names oss-safe-path.sh or oss-decision-record.sh passes too, including `oss-safe-path` 25/25, `session-routing` 124/124 and `oss-value` 350/350.
- 2026-11-06 `/oss:build` Task 3: `timeline-writer.test.sh` 23 run, 0 failed (RED first: 20 of 23 failed, `hooks/oss-timeline.sh: No such file or directory`; the 3 that passed only check that nothing was sent or misfiled). The refusal table has 47 rows across the five kinds (U+200B as a JSON escape included). G1 unchanged and green: `decision-record.acceptance` 5/5, `oss-decision-record` 111/111, `decision-push` 100/100, `feature-resolve` 8/8. Guards: `hooks-registration` 25/25, `tests-hermetic-env` 92/92, `one-copy-helpers` 12/12 (no objection to the uuid/ts copy, so it stays inline), `no-hand-capped-tests` 35/35, `oss-writer-nofollow` 49/49, `oss-state-files-nofollow` 20/20, `referenced-hooks-tracked` 45/45, `bash32-parse` 136/136. `timeline.acceptance` still 8 run, 8 failed (expected until Task 8).

## Last Updated: 2026-11-06 by /oss:build
