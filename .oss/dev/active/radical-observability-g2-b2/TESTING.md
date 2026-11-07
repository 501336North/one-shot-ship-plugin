# Testing: Radical Observability G2, Phase B2

## Strategy
- Hermetic hook tests only: sandbox HOME, fake API, fake `gh`, `run_capped`, `GIT_CONFIG_GLOBAL=/dev/null`.
- One file at a time: `/bin/bash hooks/__tests__/<name>.test.sh`. Never npm, vitest or `watcher/`.
- New file: `hooks/__tests__/timeline-archived.test.sh` (Tasks 1 to 6). Task 7 adds one case to `timeline-merge.test.sh`.
- After each agent round: `pgrep -fl "oss-timeline|run-capped|sleep 60"` to check for orphans.

## Planned cases (24)
| Task | Cases |
|------|-------|
| 1 | merge after the move goes to completed/ and is queued |
| 2 | newest wins; look-alike names ignored; no match gives unfiled; active still wins |
| 3 | linked folder (no fallback to older); linked completed/; hard-linked timeline; symlinked timeline; foreign owner; bad name; non-convention branch |
| 4 | gate, command, agent still unfiled; oss_resolve_feature unchanged |
| 5 | decision before the move accepted; unknown id refused (merge-unknown in completed/, not pushed); unsafe record refused |
| 6 | linked active/; linked active/demo; linked .oss/dev |
| 7 | bot login gives a local merge-unknown with pr |

## Results
- 2026-11-07 /oss:acceptance: `timeline-archived.test.sh` 1 run, 1 failed (RED as planned: rc 0, merge line in timeline-unfiled.ndjson with no feature, outbox empty). Harness check: `timeline-merge.test.sh` 13 run, 0 failed.
- Outbox note: no config.json is needed for an outbox entry (fp is the hash of an empty key), and the detached push exits at `oss_api_creds` before touching the outbox, so `pending` is stable. A test that adds a key must turn the push off or wait for it.
- 2026-11-07 Task 4 + Task 2: timeline-archived 9 run, 0 failed; timeline-merge 13/0; timeline-writer 23/0; timeline-gate 8/0.
  - RED: Task 1 case and "newest dated folder wins" failed (line in unfiled, outbox empty).
  - Guards that never went red (expected, they pin unchanged behaviour): the 4 Task 4 cases (gate, command, agent unfiled; oss_resolve_feature ""), and Task 2's look-alike names, no completed/, active wins.
(the rest filled in by /oss:build)

## Regression set (Task 8)
timeline-archived, timeline-merge, timeline-writer, timeline-gate, timeline-push, timeline-delivery, timeline-bounds, timeline-kept, timeline-agent-hook, notify-timeline, timeline.acceptance, decision-record.acceptance, version-check.

## Last Updated: 2026-11-07 09:34 CST by /oss:plan
