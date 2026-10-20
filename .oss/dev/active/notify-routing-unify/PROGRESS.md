# Progress: notify-routing-unify

## Current Phase: build (ship round 1 fixes complete; ready for /oss:ship)

## Tasks
- [x] T1: shared resolver (oss_resolve_project / oss_project_walk in hooks/oss-safe-path.sh) + oss-notify.sh (completed 2026-10-20)
- [x] T2: oss-log.sh five sites (log base, phase, agent, workflow, health-check) (completed 2026-10-20)
- [x] T3: TS twin watcher/src/utils/project-dir.ts; oss-error + update-workflow-state; dist rebuilt (completed 2026-10-20)
- [x] T4: oss-log.sh ${TMPDIR:-} under set -u (completed 2026-10-20)
- [x] T5: oss-value.sh _ov_walk = oss_project_walk (one copy) (completed 2026-10-20)
- [x] T6: provenance list in TESTING.md; oss-archive-check.sh (model-run) changed (completed 2026-10-20)
- [x] T7: plugin 2.0.92 (completed 2026-10-20)
- [x] R1-2/R1-3: walk stops at the first .git entry, no git call; core.worktree repros; twin parity (completed 2026-10-20)
- [x] R1-1/R1-2: per-session pointer - SessionStart writer + 30-day prune, SessionEnd removal, reader in both twins, oss-value via the resolver (completed 2026-10-20)
- [x] R1-4: no stray .oss from precommand / session-start / session-end without a project; watcher/.oss deleted (completed 2026-10-20)
- [x] R1-5: health-check through validate_project_path + new no-project message (completed 2026-10-20)

## Blockers
- None. Known pre-existing failure: commands/__tests__/ideate-template.test.sh (3/4).

## Last Updated: 2026-10-20 by /oss:build (ship round 1 implementer)
