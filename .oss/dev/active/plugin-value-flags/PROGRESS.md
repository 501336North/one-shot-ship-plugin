# Progress: plugin-value-flags (G21 cut 1, plugin Phase A)

Plan, design and decisions live in the API repo (branch feat/plugin-value-flags/plan,
`.oss/dev/active/plugin-value-flags/`).

## Current Phase: build

## Tasks
- [x] P1: `oss-value.sh dir` (completed 2026-10-19, aab0e11 / b6cae56)
- [x] P2: `oss-value.sh failed <workflow>`: RED 18/42 -> GREEN 42/42 (completed 2026-10-20, ca7383e / f301364)
- [x] P3: `oss-value.sh error cmd:<name>`: RED 34/76 -> GREEN 69/69 (completed 2026-10-20, a1fba27 / 06b78fe)
- [x] P4: HOOKS_TO_COPY installs oss-value.sh: RED 8/9 -> GREEN 9/9 (completed 2026-10-20, 4b9dbe5 / 95f012f)
- [x] P5: wrapper `failed` steps: 26 duplicates removed, oss-custom rewritten; RED 1/31 -> GREEN 31/31 (completed 2026-10-20, 58baa7e / 041161d)
- [x] P6: plugin.json 2.0.91 (2.0.90 was used by #201) (completed 2026-10-20, 208c17d); ship is the lead's
- [x] Ship round 1 R1-1..R1-6: RED f49006b -> GREEN cbc86b7 (completed 2026-10-20)
- [x] R1-7, R1-8: reported, not built (see DECISIONS.md)
- [x] Ship round 2 R2-1..R2-4: RED d021aa3 (guard: 51 lines in 27 wrappers; notification-copy 2 red; oss-value 7d 2 red) -> GREEN 7413730 + 3485b50 (completed 2026-10-20)
- [x] Ship round 3 R3-1..R3-7: RED 55d92ef (value-file-wrappers 0/32, oss-value 84 red, guard flags 29 lines) -> GREEN 8ebb265 (completed 2026-10-20)
- [x] R3-8: D5 corrected, visionos `{user_context}` in FOLLOWUPS (completed 2026-10-20)

## Deviations from the plan
- code-simplifier is NOT unserved: /oss:code-simplifier serves agents/code-simplifier, which sends
  `--workflow code-simplifier failed`. So P5 = 26 deletions + 1 rewrite (oss-custom), not 25 + 2.
- The removed blocks in green.md, red.md and refactor.md also held an `oss-log.sh error ... {REASON}`
  line (same injection class); removed with the block.
- Version 2.0.91 instead of 2.0.90.

## Blockers
- None

## Follow-ups flagged (not in scope)
- ~~`complete` notify lines with placeholders remain~~: fixed in ship round 1 R1-1 (all 42 now send '{}').
- Phase B: served prompts hash the git dir alone (~153 sites) and pass an empty CLAUDE_PROJECT_DIR when
  no .oss is found; A3/A4 must move them onto oss-value.sh (new key: toplevel + git dir) in step.
- plan.md and context-report.md keep a fixed `failed '{}'` line (no model text; possible duplicate log).
- hooks/oss-session-start-new.sh and -test.sh have their own stale HOOKS_TO_COPY (not registered).
- Round 3: the guard's unassigned-variable rule hits 21 file:NAME pairs outside the R3-5 list
  (settings.md is the big one); KNOWN_OPEN in the guard + FOLLOWUPS (D8). The value-file verbs need a
  git repo, so login --key / models set / workflows / trust refuse outside one (D7, FOLLOWUPS).

## Last Updated: 2026-10-20 07:50 +07 by /oss:build (ship round 3 implementer)
