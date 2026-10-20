# Plan: notify-routing-unify (plugin 2.0.92)

## Why
Model-run hooks (`oss-notify.sh`, `oss-log.sh`, `oss-error`) get no `CLAUDE_PROJECT_DIR` in the Bash tool, so they fall back to `~/.oss/current-project` — ONE file that every new session overwrites. With 2–3 projects open, a project's status/log events land in whichever project started last. G21 phase-B pen-test also showed the split this causes next to `oss-value.sh` (which never uses current-project). Separately, `oss-log.sh:64` crashes under `set -u` when TMPDIR is unset (common on Linux, e.g. GB10), sending every project log to ~/.oss.

## Rule (one shared resolver, IRON LAW 1b)
Project for an event = `CLAUDE_PROJECT_DIR` if set → else the nearest REAL (not a symlink) `.oss` walking up from the cwd, bounded by the git toplevel → else no project (global ~/.oss). `~/.oss/current-project` is never read for routing. Same rule as `oss-value.sh` `_ov_walk`; extract it once (e.g. `oss_resolve_project` in hooks/oss-safe-path.sh, which both already source) and route every model-run site through it.

## Tasks
- [x] T1 RED/GREEN: shared resolver + oss-notify.sh uses it. Test: two projects A and B, current-project = B; a notify run from inside A lands in A; from a repo with no .oss lands in ~/.oss; never in B.
- [ ] T2: oss-log.sh's three resolution sites (≈81-90, 303-308, 413-418) use it; same A/B test for `write`, `test`, `phase`, `agent`.
- [ ] T3: watcher oss-error (src/cli/oss-error.ts) and update-workflow-state.ts resolve the same way (when no --project-dir); rebuild dist; vitest for A/B.
- [ ] T4: oss-log.sh TMPDIR crash: `${TMPDIR:-}` (and any other unset-var reads under set -u in that function); test with TMPDIR unset → project log is project-local.
- [ ] T5: oss-value.sh `_ov_walk` reuses the shared resolver (no second copy).
- [ ] T6: provenance — list every remaining current-project reader (archive-check, precommand, statusline, session-end…) in TESTING.md: CC-run hooks get CLAUDE_PROJECT_DIR from Claude Code and may keep it as a last resort; model-run scripts may not. Change any model-run one.
- [ ] T7: version 2.0.92.

Out of scope: the served prompts (they pass CLAUDE_PROJECT_DIR explicitly or use the helper).
