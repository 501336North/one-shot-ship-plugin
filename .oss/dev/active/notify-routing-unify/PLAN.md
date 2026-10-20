# Plan: notify-routing-unify (plugin 2.0.92)

## Why
Model-run hooks (`oss-notify.sh`, `oss-log.sh`, `oss-error`) get no `CLAUDE_PROJECT_DIR` in the Bash tool, so they fall back to `~/.oss/current-project` — ONE file that every new session overwrites. With 2–3 projects open, a project's status/log events land in whichever project started last. G21 phase-B pen-test also showed the split this causes next to `oss-value.sh` (which never uses current-project). Separately, `oss-log.sh:64` crashes under `set -u` when TMPDIR is unset (common on Linux, e.g. GB10), sending every project log to ~/.oss.

## Rule (one shared resolver, IRON LAW 1b)
Project for an event = `CLAUDE_PROJECT_DIR` if set → else the nearest REAL (not a symlink) `.oss` walking up from the cwd, bounded by the git toplevel → else no project (global ~/.oss). `~/.oss/current-project` is never read for routing. Same rule as `oss-value.sh` `_ov_walk`; extract it once (e.g. `oss_resolve_project` in hooks/oss-safe-path.sh, which both already source) and route every model-run site through it.

## Tasks
- [x] T1 RED/GREEN: shared resolver + oss-notify.sh uses it. Test: two projects A and B, current-project = B; a notify run from inside A lands in A; from a repo with no .oss lands in ~/.oss; never in B.
- [x] T2: oss-log.sh's three resolution sites (≈81-90, 303-308, 413-418) use it; same A/B test for `write`, `test`, `phase`, `agent`.
- [x] T3: watcher oss-error (src/cli/oss-error.ts) and update-workflow-state.ts resolve the same way (when no --project-dir); rebuild dist; vitest for A/B.
- [x] T4: oss-log.sh TMPDIR crash: `${TMPDIR:-}` (and any other unset-var reads under set -u in that function); test with TMPDIR unset → project log is project-local.
- [x] T5: oss-value.sh `_ov_walk` reuses the shared resolver (no second copy).
- [x] T6: provenance — list every remaining current-project reader (archive-check, precommand, statusline, session-end…) in TESTING.md: CC-run hooks get CLAUDE_PROJECT_DIR from Claude Code and may keep it as a last resort; model-run scripts may not. Change any model-run one.
- [x] T7: version 2.0.92.

Out of scope: the served prompts (they pass CLAUDE_PROJECT_DIR explicitly or use the helper).

# Ship round 1 (2026-10-20) — user chose "Per-session pointer"

Gates: performance PASS, security PASS (LOWs), quality FAIL (HIGH: stray sub-folder `.oss` captures events; MEDIUM: submodule / outside-repo cwd goes global), pen-test FAIL (MEDIUM: `core.worktree` moves the walk bound into an enclosing project; LOW: shell/TS twins disagree on whitespace in the toplevel).

New rule (one shared resolver, shell + TS twins identical):
1. `CLAUDE_PROJECT_DIR` if set (Claude Code hooks).
2. This session's pointer: `~/.oss/sessions/<CLAUDE_CODE_SESSION_ID>/project`, written by the SessionStart hook (which gets `session_id` in its stdin JSON and `CLAUDE_PROJECT_DIR` from Claude Code). Use it only if: the id matches `^[A-Za-z0-9-]{1,100}$`; `~/.oss/sessions`, the id folder and the file are owned by the user, not symlinks, 700/600; the content is one absolute line; that dir has a real `.oss`.
3. Nearest real `.oss` walking up from `pwd -P`, stopping at (and including) the first directory that holds a `.git` entry (dir or file) — no git calls, so `core.worktree` / GIT_* env cannot move it and there is no git output to trim.
4. Else global `~/.oss`.
`~/.oss/current-project` stays unread by model-run code.

- [x] R1-1: SessionStart writes the pointer (owner-only, atomic, refuse a linked ~/.oss/sessions); SessionEnd removes it; prune pointers older than 30 days (spike decision; was 7). Tests: two sessions with different ids and projects; each hook run with one id lands in that session's project from any cwd (repo subfolder with a stray `.oss`, outside the repo, inside a submodule).
- [x] R1-2: resolver steps 2 and 3 in `oss-safe-path.sh` and `watcher/src/utils/project-dir.ts` (identical rules; twin-parity test with names containing spaces/newlines and a `.git` file); drop the git call; rebuild dist.
- [x] R1-3: pen-test repros as RED: `core.worktree=../..` and a nested repo with `core.worktree=<A>` → never the enclosing project.
- [x] R1-4: stray `.oss`: find and fix the test(s) that create `.oss` in the checkout's sub-folders (e.g. `watcher/.oss`), and `oss-precommand.sh`'s `mkdir -p ./.oss` fallback when no project is known; delete the stray dirs in this checkout.
- [x] R1-5: `oss-log.sh health-check` passes the resolved dir through `validate_project_path` and its no-project message says "Not inside a project (no .oss found and no session pointer)".

## Round 1 spike results (2026-10-20, user: "yes")
- Proven here: Bash `CLAUDE_CODE_SESSION_ID` == this session's transcript id; unchanged across compaction; a subagent's Bash sees the PARENT's id.
- Not documented by Claude Code: `CLAUDE_CODE_SESSION_ID` itself; id stability across resume / clear / compact.
- So R1-1 is: the SessionStart hook writes the pointer under `$CLAUDE_CODE_SESSION_ID` (same variable Bash reads — writer and reader cannot disagree) and ALSO under the stdin `session_id` when present and different. Every SessionStart (startup/resume/clear/compact) rewrites it. Prune only pointers whose files are >30 days old; SessionEnd removes its own. Readers without the variable or without a pointer fall back to the walk, never to another session's project.
- Required test: four sessions (ids S1..S4 → products P1..P4), pointers written in any order and at different times; hooks run with each id from cwd = repo subfolder with a stray `.oss`, outside any repo, inside a submodule → always that session's product; a missing/linked/foreign-owned/relative pointer → walk fallback.

## Round 1 build result (2026-10-20)
All five done, one commit each (88e8b51 walk R1-2/R1-3, 99109b0 pointer R1-1/R1-2, b4fc26d stray R1-4,
a1518c4 health-check R1-5). Rule and reasons: DECISIONS.md D2. Tests: TESTING.md "Ship round 1".
Not changed (outside this round): session-start still writes `.claude/settings.local.json` and
`.gitignore` via oss-setup-permissions.sh into `.` when CLAUDE_PROJECT_DIR is unset (tests only; CC
always sets it).
