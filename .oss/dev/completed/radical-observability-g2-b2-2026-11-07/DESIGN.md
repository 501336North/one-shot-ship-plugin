# Design: Radical Observability G2, Phase B2 (plugin 2.0.99)

## Status: approved 2026-11-07 (API repo ADR-017, user picker "Plugin resolves completed/")

## Why
G2 Phase C (served prompts, AgenticDevWorkflow) changes ship so the archive (docs moved to `.oss/dev/completed/<feature>-<date>/`, with `timeline.ndjson` and the finalized build report) is committed inside the feature PR just before the merge. That way there is no second PR for any customer. The merge line is written after the merge, but by then `.oss/dev/active/<feature>/` no longer exists. Today `oss_resolve_feature` then returns no feature, and `oss-timeline.sh` files the line in `.oss/dev/timeline-unfiled.ndjson`, which is never pushed (P-3, `hooks/oss-timeline.sh:145-149`). So the merge line never reaches the API.

Source of truth for the whole feature: AgenticDevWorkflow `.oss/dev/active/radical-observability-g2/` (PLAN.md "Phase B2", DECISIONS.md ADR-017, REQUIREMENTS.md AC-G2-003.3 amended). Earlier plugin decisions P-1 to P-19: `.oss/dev/completed/radical-observability-g2-2026-11-07/DECISIONS.md` in this repo.

## Scope
- **B7. The merge line finds the archived folder.** In `oss-timeline.sh merge` only: when `oss_resolve_feature` returns no feature and the project's own branch is `<type>/<feature>/<phase>`, look for `.oss/dev/completed/<feature>-YYYY-MM-DD/` and use the newest by date. It must be a real folder (not a symlink), its `timeline.ndjson` must be a regular, single-link file or absent, and `<feature>` must pass the same name rule. The line is written there with `feature: <feature>` and pushed like any filed line. `oss_resolve_feature` itself and every other kind (command, agent, gate) stay unchanged, so G1 and the other writers see no difference.
- **B8. The decision check reads the same folder.** The `decision:<uuid>` approval check reads `decisions.ndjson` from the folder B7 resolved, so an id recorded before the move is accepted after it.
- **B9. Release as 2.0.99.**

## Tests (RED first)
- Folder moved to `completed/<f>-<date>/` on branch `feat/<f>/ship`: `timeline merge` appends to the completed file and queues a push (today it goes to unfiled).
- Refused, staying unfiled and never pushed: a symlinked `completed/<f>-<date>`, a multi-link timeline file, a name failing the rule, no matching folder.
- Two dated folders: the newest wins.
- A gate or command line with no active folder still goes to unfiled (unchanged).
- B8: a decision id recorded before the move is accepted after it; an unknown id is still refused.

## Out of scope
- Any change to `oss_resolve_feature`, G1 decisions, or the gate verb.
- The served prompts (Phase C, API repo).

## Rules
- Hermetic hook tests only: sandbox HOME, `run_capped`, one test file at a time with `/bin/bash hooks/__tests__/<name>.test.sh`.
- Never run npm, vitest or anything under `watcher/`: its test setup kills OSS processes machine-wide.
