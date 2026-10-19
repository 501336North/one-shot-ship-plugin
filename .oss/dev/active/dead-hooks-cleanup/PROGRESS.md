# Progress: dead-hooks-cleanup

## Current Phase: build

## Tasks
- [x] T1: provenance of the 7 hooks; 9 scripts unreachable (7 + sse-telegram-listener + oss-detect-formatter), see NOTES.md (completed 2026-10-19)
- [x] T2: hooks-registration.test.sh RED 13/23 -> GREEN 23/23; dead .claude-plugin/hooks.json and 9 scripts removed (completed 2026-10-19)
- [x] T3: stale registration tests retargeted to root hooks.json; format-hook.test.sh and post-tool-use-hooks.test.ts deleted (tested only removed code) (completed 2026-10-19)
- [x] T4: v2.0.90; hooks/__tests__ 29/29 files, commands/__tests__ 8/9 (ideate-template unrelated), watcher/test/hooks 181/181 (completed 2026-10-19)

## Blockers
- None

## Follow-ups flagged (not in scope)
- `.claude-plugin/hooks/reload-context.sh`, `save-context.sh`: referenced by nothing; dead.
- API `build-team.md` describes team-idle / team-task-completed hooks that never ran.
- API Telegram question/answer endpoints now unused (per PLAN).

## Last Updated: 2026-10-19 23:28 +07 by refactoring-specialist (/oss:build T1-T4)

## Gate round 1 (2026-10-19)
- [x] G1: check (b) requires -x; exec-bit mutant now red (22/23), real 23/23
- Gates: performance PASS, pen-test PASS, security PASS, code-review PASS. NAG discarded: matcher allow-list regex, hooks/hooks.json not checked, /bin/sh first-word, reload/save-context dead files. build-team.md stale hook claims = API repo, already in FOLLOWUPS.

## Last Updated: 2026-10-19 by /oss:build (gate round 1)
