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

## D2: per-session pointer, then a git-free walk (ship round 1, 2026-10-20)

**Why D1 was not enough.** The cwd is not a reliable per-session signal: a stray `.oss` in a product's
sub-folder (this checkout grew `watcher/.oss` from a test) captured that sub-folder's events; a command
run from outside the repo or from a submodule went to the global `~/.oss`; and git's toplevel can be
moved by repo config (`core.worktree=../..`, or an absolute path into an enclosing project), so the
walk could climb into another product. The user's requirement: four sessions, started minutes or days
apart, on four products at once - every event lands in its own session's product.

**Rule (shell `oss_resolve_project` in hooks/oss-safe-path.sh, TS `resolveProjectDir` in
watcher/src/utils/project-dir.ts; identical):**
1. `CLAUDE_PROJECT_DIR` if set (Claude Code-run hooks, served prompts, tests).
2. This session's pointer `~/.oss/sessions/<CLAUDE_CODE_SESSION_ID>/project`, used only when the id
   matches `^[A-Za-z0-9-]{1,100}$`; `~/.oss/sessions`, the id folder and the file are the user's own and
   not links; the content is one absolute line (no control characters); that folder has a real `.oss`.
3. The nearest real `.oss` walking up from the physical cwd, stopping at (and including) the first
   directory that holds a `.git` entry (dir or file). No git call: no config or `GIT_*` variable can move
   the bound, and there is no git output to trim (the twins used to disagree on a trailing space). No
   `.git` anywhere above: no project.
4. Else no project: the global `~/.oss`.

**Why the env var AND the stdin id.** The Bash tool sets `CLAUDE_CODE_SESSION_ID` (proven: equals the
transcript id, stable across compaction, a subagent's Bash sees the parent's id), and the hooks inherit
the same variable - so writing under it means writer and reader cannot disagree. It is not documented by
Claude Code, nor is its stability across resume/clear; the SessionStart stdin `session_id` is
documented, so the pointer is ALSO written under it when present and different. Every SessionStart
(startup/resume/clear/compact) rewrites the pointer.

**Writer.** `oss_session_pointer_write` (SessionStart): dirs 700, file 600, written to a temp file in the
id folder and renamed (atomic); refuses a linked or foreign-owned `~/.oss/sessions` or id folder.
SessionEnd removes its own pointer(s) (env id and stdin id); the same script also runs on PreCompact,
which keeps them (`hook_event_name`).

**Prune at 30 days.** Sessions can be resumed days later, so a pointer must outlive a few days of
inactivity; a crashed session never runs SessionEnd, so something must clean up. Each SessionStart
removes pointer folders whose file is older than 30 days (`find -mtime +30`), never the starting
session's own ids. A resumed session that is older simply gets its pointer rewritten.

**Fallback order.** A missing, linked, foreign-owned, relative, multi-line or `.oss`-less pointer, or an
unset/invalid id, falls to the walk - never to another session's pointer, never to
`~/.oss/current-project` (still written for the CC-run statusline/precommand legacy readers, never read
by model-run code).

**Also (R1-4/R1-5).** oss-precommand.sh no longer creates `./.oss` when no project is known; session-start
and session-end create `.oss` only in `CLAUDE_PROJECT_DIR` (their `.` fallback made `watcher/.oss` when a
test ran them from the watcher folder). `oss-log.sh health-check` runs only in a project that passes
`validate_project_path`, else "Not inside a project (no .oss found and no session pointer)".

## D3: walk vs pointer, and whose .oss counts (ship round 2, 2026-10-20)

**Walk vs pointer (R2-1).** D2 trusted the session pointer before looking at the cwd, so a session
started in product 1 that moved on to product 2 kept sending product 2's events to product 1. The
resolver now runs the git-free walk first and compares bounds:
1. `CLAUDE_PROJECT_DIR` if set (unchanged).
2. Walk from the physical cwd -> W (nearest owned real `.oss`) and Wg (the dir holding the first `.git`).
3. Pointer P valid: if W is empty, or Wg equals the bound of P (the walk from P's PHYSICAL path), P wins.
   Otherwise W wins - it is a different repo with its own `.oss`.
4. No valid pointer: W, else the global `~/.oss`.
Comparing bounds, not paths, is what keeps the D2 cases: a stray `.oss` in a sub-folder of the pointer's
repo (same bound -> pointer), a submodule or nested repo without `.oss` (W empty -> pointer), outside any
repo (W empty -> pointer). P is resolved physically so a pointer spelled through `/tmp` or a link still
matches its own repo's bound. Shell `oss_resolve_project` / TS `resolveProjectDir`, identical.

**Ownership (R2-2), mirrors git's safe.directory.** The walk accepts a `.oss` only when it is a real
directory (not a link) owned by the current user; a foreign one is skipped and the walk keeps climbing to
the bound. When the dir holding the `.git` entry is not owned by the user the walk yields NO project
(then the pointer, else `~/.oss`). Closes "anyone who can create /tmp/.git + /tmp/.oss captures every
command run below /tmp". Consequence, accepted: a repo on a root-owned bind mount, used by a non-root
user, resolves no project by the walk (git itself refuses such a repo without safe.directory); the
pointer / CLAUDE_PROJECT_DIR still name it. The write guard's uid-0 project-root rule (`_oss_owned_ok`)
answers a different question - where a write may go once the project is chosen - and is unchanged.

**One physical-path rule (R2-5).** `_oss_phys_dir` (-> `_OSS_PD`) and `oss_phys_cwd` (-> `_OSS_CWD`) in
oss-safe-path.sh are the only places a physical path is computed for routing and the write guard; they
keep a trailing newline (no `$(...)` on the result). oss-value, the resolver, the guard and oss-log's
`validate_project_path` (now -> `_OSS_VALID`) go through them.

**Test seam.** Owner checks in oss-safe-path.sh are spelled `test -O` (not `[[ -O ]]`), so a test can
simulate another user's folder with a BASH_ENV `test` function; TS uses a geteuid spy or a `--require`
shim on `fs.lstatSync`'s uid. Without root, macOS cannot produce a foreign-owned folder in a temp dir.
