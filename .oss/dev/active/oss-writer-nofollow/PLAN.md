# Implementation Plan: oss-writer-nofollow (SECURITY hotfix, v2.0.87)

## Summary
Plugin writers that put files under a PROJECT's `.oss/` directory follow symlinks and hard links. A malicious repo that commits `.oss/workflow-state.json -> ../../../.zshrc` gets the target overwritten on the first OSS event. Committed symlinks are recreated by `git clone`.
- **Reproduced** by the AgenticDevWorkflow notify-project-routing pen-test gate, 2026-10-19.
- **What an attacker can do with the state file:** a non-JSON target is truncated and overwritten. A JSON target (for example `~/.claude/settings.json`) is merged and gains keys.
- **With `.oss/workflow.log` or `.oss/logs/current-session/*.log`:** a line is appended to any file the user can write.
- **With `.oss`, `.oss/logs` or `current-session` pointing at an outside directory** (for example `~/.ssh`): files are created there.
- **Limits:** the attacker picks only the target path. The content is fixed JSON or sanitised log lines, so there is no code execution. Hard links behave the same, but git cannot deliver them.
- **Exposure today:** a single-session user whose `~/.oss/current-project` names the malicious repo. That includes the plugin wrapper's ordinary `start` event, which writes the routed workflow-state.

## Source
Boss, 2026-10-19: "make you the boss" and resolve fully. Orchestrated from the AgenticDevWorkflow-g21 session. This lands FIRST among the plugin PRs; plugin-highs takes 2.0.88 after it.

## Decision (ADR-1): one shared guard per runtime, used by every project-.oss writer
- **Bash:** a sourced helper, `hooks/oss-safe-path.sh`. HOOKS_TO_COPY must ship it next to oss-log.sh and oss-notify.sh, and every caller loads it with the `if [[ -f … ]]; then source …; fi` pattern from PR #192.
- **Node:** one module, `watcher/src/utils/safe-project-write.ts` (name to fit the repo).
- **Rule for a write to `<project>/.oss/<rel>`:**
  - `<project>` is a real directory: realpath resolves, and it lies under HOME or TMPDIR, as the existing validators already require.
  - No component from `<project>/.oss` down to the target's parent is a symlink, and each one is a directory owned by the current user.
  - The target is either absent or a regular file with link count 1 that is not a symlink.
  - realpath(target parent) stays inside realpath(`<project>/.oss`).
- **When a check fails:** do NOT write. Print one line to stderr (`oss: refusing unsafe .oss path <rel>`) and exit 0, so a hook never breaks the user's flow, matching today's best-effort writers.
- **JSON state:** write a temp file in the same directory with `O_EXCL | O_NOFOLLOW` (Node: `fs.openSync(tmp, 'wx', 0o600)` after the checks), then `fs.renameSync`. rename replaces a symlink entry without following it.
- **Appends:** open with `O_APPEND | O_NOFOLLOW` (Node: `fs.constants.O_NOFOLLOW`). Bash: check `[ -L ]` and the link count immediately before `>>`. That is TOCTOU-limited, so document it; the target dir is user-owned.
- **Creating `.oss` or subdirectories:** `mkdir` one component at a time, then re-check `! -L` and `-O`.

## Also in this PR (from plugin-highs gate MEDIUM-a + LOWs; plugin-highs agreed it is mine)
- `hooks/oss-notify.sh`: validate the workflow name (`^[a-z][a-z0-9-]{0,40}$`) before it reaches chain-trigger or any URL/path. An invalid name is refused with rc 0 and a stderr note. Example: `build/../ship` must not fire ship's chain.
- `oss-notify.sh:254`: fix the stray quotes in the default `'{}'`.
- `oss-notify.sh:307,370`: build JSON with jq, or a safe printf of validated fields, never by pasting strings.

## Out of scope (separate plugin PR "routing fallback", after this one)
- Prefer the cwd's nearest `.oss` ancestor over `~/.oss/current-project`.
- The HOME/TMPDIR validator gap for repos outside HOME.
- A `complete` state check: no chain after a failed ship. Log it in FOLLOWUPS.

## TDD tasks (RED first, minimal GREEN, anti-vacuity per task; never `git stash`; targeted tests only)
- **N0 provenance (IRON LAW #1b), first:** grep hooks/*.sh and watcher/src for every write, append or mkdir under a PROJECT `.oss` (anything built from CLAUDE_PROJECT_DIR, current-project, the git toplevel, `--project-dir` or the cwd). Classify each site as project-.oss (must use the guard), `~/.oss` (user-owned, out of scope) or read-only. Record the list in NOTES.md. Known sinks: hooks/oss-log.sh:108-109,231-232; watcher/src/services/workflow-state.ts:~362; watcher/src/cli/oss-error.ts:~165; probably workflow-logger.ts, session start's `.oss` and `.gitignore` creation, queue manager, routing-log and iron-law-monitor. Verify each.
- **N1 RED:** a test helper builds a temp HOME plus a "malicious repo" (git init, commit, clone) with committed links:
  - `.oss/workflow-state.json -> <outside file>`
  - `.oss/workflow.log -> <outside file>`
  - `.oss/logs -> <outside dir>`
  - `.oss/logs/current-session -> <outside dir>`
  - `.oss -> <outside dir>`
  - plus a hard-linked state file.

  For each sink, run the REAL hook or CLI (`oss-notify.sh --workflow build failed`, `oss-log.sh write`, `update-workflow-state.js setSupervisor`, `oss-error.js`) and assert the outside target is byte-identical and nothing was created outside. Run under /bin/bash 3.2 and bash 5. Add a control: a normal repo still gets its state and logs.
- **N2 GREEN:** the helpers, plus every N0 project-.oss site routed through them.
- **N3:** workflow-name validation in oss-notify.sh and the 2 LOWs, each with its own RED.
- **N4:** bump `.claude-plugin/plugin.json` 2.0.86 → 2.0.87, add the new helper to HOOKS_TO_COPY, and record LEARNINGS and FOLLOWUPS.

## Rules for the builder
- Work only in /Users/ysl/dev/one-shot-ship-plugin-nofollow.
- Never run `pkill -f vitest`. Run watcher vitest with a config that does NOT load watcher/test/setup.ts, because its `pkill -f watcher/dist/index.js` kills the user's live watcher. The previous agent's config is at /private/tmp/claude-501/-Users-ysl-dev-AgenticDevWorkflow-g21/f1048960-50ff-44e1-aa64-8510f7eb7f1f/scratchpad/vitest.nosetup.config.mjs.
- Pin `CLAUDE_PROJECT_DIR=/Users/ysl/dev/one-shot-ship-plugin-nofollow` on any `~/.oss/hooks/oss-log.sh` call. Never touch any other project's `.oss` or the real `~/.oss` state.
