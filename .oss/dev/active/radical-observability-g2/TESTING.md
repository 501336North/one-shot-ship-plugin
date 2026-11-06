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
- None yet (plan phase).

## Last Updated: 2026-11-06 by /oss:plan
