# Progress: iron-laws-sync-recovery

## Current Phase: build

## Tasks
- [x] T1: Recurrence guard `hooks/__tests__/referenced-hooks-tracked.test.sh` (RED 19/22 on oss-iron-laws-sync.sh, GREEN 22/22) (completed 2026-10-16)
- [x] T2: Restore 4 files from 1241889; fix last-line data loss in update_between_markers; behavioural copy test; auto.md note (completed 2026-10-16)
- [x] T3: Clean-machine check against real API (create, idempotent fast + stale paths, user content preserved) (completed 2026-10-16)
- [x] T4: plugin.json 2.0.83 -> 2.0.84 (repo keeps no CHANGELOG) (completed 2026-10-16)

- [x] R1-R8 ship-gate round 1 fixes (via /oss:build, 2026-10-16): refresh-only session start + `--install`; symlink/$HOME/non-regular refusal; exact markers; body validation + 1h backoff; detached session-start dispatch, curl 2s/4s/256KB caps; shared `hooks/oss-api-curl.sh` (key on curl stdin) routed through 10 sites; awk rewrite, same-dir temp + mode + atomic mv, mkdir lock w/ stale handling, node JSON.parse; login Step 4 single writer; behavioural session-start tests; T1 guard covers ${CLAUDE_PLUGIN_ROOT}/hooks (completed 2026-10-16)
- [x] S1 legacy `<!-- IRON LAWS START -->` read as START, rewritten canonical (refresh + --install) (completed 2026-10-16)
- [x] S2 --install exit 3 (refused) / 4 (no laws); login Step 4 skips 4.2-4.3 on any non-zero exit and tells the user why (completed 2026-10-16)
- [x] S3 apiKey via node, else python3 json.load, else strict pure-bash flat parser (fails closed); path not key in argv (completed 2026-10-16)
- [x] S4 marker lines compared after trailing-whitespace/CR strip; added lines follow the file's CRLF (completed 2026-10-16)

## Blockers
- New files (incl. hooks/oss-api-curl.sh and 3 new test files) are `git add -N` only; orchestrator commits.

## Last Updated: 2026-10-16 17:33 +07 by /oss:build (ship-gate round 2, S1-S4)
