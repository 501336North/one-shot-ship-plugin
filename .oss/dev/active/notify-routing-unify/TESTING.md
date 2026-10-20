# Testing: notify-routing-unify

## Strategy
Outside-in: the REAL hooks and the REAL built watcher CLIs run in a sandbox HOME with two real git
projects A and B (both with a real `.oss`), `~/.oss/current-project` = B, `CLAUDE_PROJECT_DIR` unset,
cwd in `A/sub/deep`. Plus C (repo, no `.oss`) and D (repo whose `.oss` is a link). Each event must land
in A (or `~/.oss` from C/D), never in B, never through the link.

- `hooks/__tests__/project-routing.test.sh` (new, 43 assertions): T1 notify state, T2 notify + oss-log
  write/test/phase/agent logs, phase/agent state, workflow set-feature, health-check; T3 oss-error and
  update-workflow-state CLIs + end-to-end "B untouched"; T4 TMPDIR unset; T5 oss-value failed + "the walk
  exists once"; T6 archive-check.
- `watcher/test/utils/project-dir.test.ts` (new, 6): the TS twin.
- Retargeted (they pinned the old current-project rule): watcher `test/hooks/oss-log-{error-recovery,
  milestone-skill,hook-action,project,project-local,health-check}.test.ts`, `oss-notify-project.test.ts`,
  `test/cli/update-workflow-state.test.ts` - now run inside a git-initialised project (cwd) or outside any
  project (`cwd: os.tmpdir()`), with current-project pointing elsewhere to prove it is ignored.

## T6: remaining `~/.oss/current-project` readers (provenance)

| Site | Runs as | Decision |
|------|---------|----------|
| `hooks/oss-session-start.sh` (+ `-new`, `-test` copies) | CC SessionStart hook | WRITER; kept (other CC-run hooks' legacy fallback) |
| `hooks/oss-session-end.sh` | CC SessionEnd hook | clears it; kept |
| `hooks/oss-statusline.sh` | CC statusLine (stdin `workspace.current_dir` first) | kept as legacy last resort |
| `hooks/oss-precommand.sh` | CC UserPromptSubmit hook (`CLAUDE_PROJECT_DIR` first) | kept as last resort |
| `hooks/oss-archive-check.sh` | MODEL-RUN (served `/oss:plan` runs it via Bash, no `--project-dir`) | CHANGED -> `oss_resolve_project` (RED: from A it archived B's finished feature) |
| `hooks/oss-notify.sh`, `hooks/oss-log.sh` (5 sites) | model-run | CHANGED (T1, T2) |
| `watcher/src/cli/oss-error.ts`, `update-workflow-state.ts` | model-run (and via hooks) | CHANGED (T3) |
| `hooks/oss-value.sh` | model-run | never read it; walk now shared (T5) |

`grep -rlF current-project hooks watcher/src` after this branch: only the CC-run rows above.
Not changed: `hooks/oss-statusline.sh` also reads bare `$TMPDIR`, but it does not run under `set -u` (no crash).

## Results (2026-10-20)
See PROGRESS.md for the final sequential run counts.
