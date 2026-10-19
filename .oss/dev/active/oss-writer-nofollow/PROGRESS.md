# Progress: oss-writer-nofollow (security hotfix)

## Current Phase: build (ship round 1 fixes complete, ready for the /oss:ship re-gate)

## Tasks
- [x] N0: provenance sweep of project-.oss writers (completed 2026-10-19). 31 sites classified; see NOTES.md
- [x] N1: RED: malicious-repo symlink/hardlink suite against the real hooks and dist CLIs (completed 2026-10-19). Commit 3bd4178
- [x] N2: GREEN: shared bash and Node guards, every site routed through them, dist rebuilt (completed 2026-10-19). Commits 9da8643, 1beee91 (refactor)
- [x] N3: oss-notify.sh workflow-name validation, plus the 2 LOWs (completed 2026-10-19). In 9da8643; the RED for these is in 3bd4178
- [x] N4: v2.0.87 bump, HOOKS_TO_COPY with a behaviour test, LEARNINGS, FOLLOWUPS (completed 2026-10-19). Commits c44d7ec, 7ceba80, plus the docs commit

## Ship round 1 (G1-G17)
- [x] G1 archive-check skips dev/active/<name> links (completed 2026-10-19)
- [x] G2 control chars refused; target built from the walked dir; oss-log validates <name>.log (completed 2026-10-19)
- [x] G3 owner = current user OR project-root owner, both twins; G12 by construction (completed 2026-10-19)
- [x] G4 G5 G8 G14 (completed 2026-10-19)
- [x] G6 G7 G13 (completed 2026-10-19)
- [x] G9 G10 G15 refactor (completed 2026-10-19)
- [ ] G11, G16, G17 deferred to FOLLOWUPS (reasons in DECISIONS.md)

## Ship round 2 (N2-1 to N2-5)
- [x] N2-1 tail goes through the session.log guard (completed 2026-10-19)
- [x] N2-2 foreign owner only under a uid-0 root and not g/o-writable, both twins (completed 2026-10-19)
- [x] N2-3 mode from the checked lstat & 0o777 (completed 2026-10-19; no macOS RED possible)
- [x] N2-4 new webhook config.json 0600 (completed 2026-10-19)
- [x] N2-5 TOCTOU comment (completed 2026-10-19)
- [x] N2-6 HOME symlinked config.json keeps target mode (completed 2026-10-19)

## Post-merge test harness (H1-H3)
- [x] H1 oss-session-context-local "Auto .gitignore Setup" runs session start by path, not `cat | bash` (completed 2026-10-19)
- [x] H2 oss-notify-telegram stages `hooks/oss-safe-path.sh` next to the rewritten oss-notify copy (completed 2026-10-19)
- [x] H3 oss-log-project-local uses `project-a-cmd` / `project-b-cmd` (completed 2026-10-19)

## Blockers
- None. The plugin-highs session (2.0.88) waits for this PR to merge.
- Merge note: watcher/dist/**/*.d.ts.map changed in many files (line shifts). chain-trigger.js and chain-trigger.cjs were NOT touched.

## Last Updated: 2026-10-19 18:15 +07 by /oss:build H1-H3
