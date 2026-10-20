# Decisions: notify-routing-unify

## D1: one routing rule for every model-run script (2026-10-20)

**Rule.** The project an event belongs to is:
1. `CLAUDE_PROJECT_DIR`, when set (unchanged: Claude Code sets it for the hooks it runs, tests and served prompts pass it explicitly);
2. else the nearest REAL (not a symlink) `.oss` directory walking up from the physical cwd, bounded by the git toplevel;
3. else no project: the user's global `~/.oss`.

One implementation per runtime:
- shell: `oss_project_walk <dir>` + `oss_resolve_project` in `hooks/oss-safe-path.sh` (already sourced by every hook that writes into a project);
- TS: `resolveProjectDir(env, cwd)` in `watcher/src/utils/project-dir.ts` (twin, same rule).

Routed through it: `oss-notify.sh`, all five `oss-log.sh` sites (log base, phase and agent `--project-dir`, `workflow` health state, `health-check`), `oss-value.sh` `_ov_walk`, `oss-archive-check.sh` (when no `--project-dir`), `oss-error.js`, `update-workflow-state.js` (when no `--project-dir`).

**Why `~/.oss/current-project` is dropped for routing.** It is ONE file that every new Claude Code session overwrites (session-start writes it, session-end empties it). The Bash tool sets no `CLAUDE_PROJECT_DIR`, so every model-run script fell back to it: with two or three projects open, A's status, logs, errors (and even `/oss:plan`'s archive step) went to whichever project started last. The cwd is the only per-session signal a model-run script has, and `oss-value.sh` (#374) already routed this way, so the plugin answered the same question two ways. A linked `.oss` is never followed (a cloned repo cannot redirect writes), and the walk stops at the git toplevel (a nested repo without `.oss` does not borrow its parent's).

**Kept.** session-start/session-end still write/clear current-project and the CC-run statusline / precommand keep it as a legacy last resort (see TESTING.md, T6): they get `CLAUDE_PROJECT_DIR` (or stdin's workspace) from Claude Code first, so the fallback is not reached in a real session.

**Small differences, accepted.** In the TS CLIs a `CLAUDE_PROJECT_DIR` that is set but invalid/nonexistent now falls to the global state (before: to current-project). With no project at all, `oss-error` appends to `~/.oss/workflow.log` (before: no sink, warning) - the same place `oss-value.sh error` already sent it.
