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
(filled in by /oss:build)

## Regression set (Task 8)
timeline-archived, timeline-merge, timeline-writer, timeline-gate, timeline-push, timeline-delivery, timeline-bounds, timeline-kept, timeline-agent-hook, notify-timeline, timeline.acceptance, decision-record.acceptance, version-check.

## Last Updated: 2026-11-07 09:34 CST by /oss:plan
