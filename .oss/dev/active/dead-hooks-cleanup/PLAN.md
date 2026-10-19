# Plan: dead-hooks-cleanup (v2.0.90)

## Why
`.claude-plugin/hooks.json` is never loaded by Claude Code: `plugin.json` points at the root `./hooks.json`, and the docs confirm only that file plus `hooks/hooks.json` load. Its matchers (`tool == "X"`) are also invalid. Seven hooks registered only there have never run for any customer, and nothing advertises them.

User decision (2026-10-19): remove them.

The seven: oss-ask-telegram, oss-ask-telegram-answered, post-bash-pr, post-edit-quality, oss-auto-format, team-task-completed, team-idle.

## Tasks
- [ ] **T1 (provenance first):** for each of the 7, find every reference.
  - Known: `oss-notification.sh` and `sse-telegram-listener.sh` mention `oss-ask-telegram`; `post-edit-quality` calls `oss-auto-format`; `watcher/test/hooks/post-tool-use-hooks.test.ts`; `hooks/__tests__/format-hook.test.sh`.
  - Decide, for each script, whether it is reachable from a LOADED registration (root `hooks.json`), a command or the watcher. Only unreachable code is deleted.
  - If `oss-notification.sh` (Notification event, loaded) really invokes `oss-ask-telegram.sh`, keep that path and record why.
  - The team-* scripts may not exist; then only their dead registrations go.
- [ ] **T2 (RED → GREEN):** `hooks/__tests__/hooks-registration.test.sh`:
  - (a) `.claude-plugin/hooks.json` does not exist;
  - (b) every `command` in root `hooks.json` points at an existing file;
  - (c) every root `hooks.json` matcher is a valid Claude Code matcher (a tool name, a `|` list, or `*`), not a `tool == …` expression;
  - (d) none of the removed scripts exists, unless T1 found it reachable.
  - **RED today:** (a) fails.
  - **GREEN:** delete the dead file and the unreachable scripts.
- [ ] **T3:** the stale tests. `config-change-guard`, `format-hook` and `worktree-hooks` read a non-existent `hooks/hooks.json`.
  - Retarget their registration checks to root `hooks.json`, where ConfigChange and Worktree really are registered.
  - Delete the `format-hook` test only for parts that test the removed auto-format; keep any part covering live code.
  - Same for `post-tool-use-hooks.test.ts`.
  - Report the test-count delta.
- [ ] **T4:** v2.0.90, then run the whole `hooks/__tests__`, `commands/__tests__` and `watcher/test/hooks` (no-setup config, `CLAUDE_PROJECT_DIR` unset).
- **Not in scope:** the API Telegram question/answer/subscribe endpoints become unused. They are a candidate for a later API cleanup, not touched here.
