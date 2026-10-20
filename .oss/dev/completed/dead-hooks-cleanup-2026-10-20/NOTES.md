# Notes: dead-hooks-cleanup

## T1: provenance (2026-10-19)

Method: `git grep -nF <name>` across the plugin repo (excluding `.oss/`), plus name variants
(`auto-format`, `ask-telegram`, `telegram-listener`, `task-completed`, `TeammateIdle`, `TaskCompleted`,
`bash-pr`, `edit-quality`), plus `commands/`, `agents/`, `skills/`, `watcher/src`, `HOOKS_TO_COPY` in
`hooks/oss-session-start.sh`, and the API repo (`AgenticDevWorkflow/packages`).

Loaded paths: `.claude-plugin/plugin.json` → `"hooks": "./hooks.json"` (ROOT). `hooks/hooks.json` does
not exist. Root `hooks.json` registers: UserPromptSubmit (precommand, iron-law-check, context-inject),
SessionStart, PreCompact, SessionEnd, Notification (`oss-notification.sh`), Stop, WorktreeCreate,
WorktreeRemove, ConfigChange. It has **no matchers at all**, and no PreToolUse/PostToolUse/TaskCompleted/
TeammateIdle events.

| Script | Exists | References outside its own file | Reachable from a loaded path? | Action |
|---|---|---|---|---|
| `oss-ask-telegram.sh` | yes | `.claude-plugin/hooks.json` (PreToolUse); a **comment** in `oss-notification.sh:68`; a comment in `sse-telegram-listener.sh:88`; LEARNINGS.md prose | **No.** `oss-notification.sh` is loaded (Notification) but only mentions it in a comment; it never executes it. | delete |
| `oss-ask-telegram-answered.sh` | yes | `.claude-plugin/hooks.json` (PostToolUse) only | No | delete |
| `post-bash-pr.sh` | yes | `.claude-plugin/hooks.json`; `watcher/test/hooks/post-tool-use-hooks.test.ts` | No | delete |
| `post-edit-quality.sh` | yes | `.claude-plugin/hooks.json`; `post-tool-use-hooks.test.ts` | No | delete |
| `oss-auto-format.sh` | yes | `.claude-plugin/hooks.json`; a comment in `post-edit-quality.sh:43`; `hooks/__tests__/format-hook.test.sh` | No | delete |
| `team-task-completed.sh` | yes | `.claude-plugin/hooks.json`; API prompt `build-team.md` describes it in prose (no invocation) | No | delete |
| `team-idle.sh` | yes | `.claude-plugin/hooks.json`; API prompt `build-team.md` prose | No | delete |
| `sse-telegram-listener.sh` | yes | launched only by `oss-ask-telegram.sh:127` (`nohup`) | No: its only launcher is dead | delete |
| `oss-detect-formatter.sh` | yes | called only by `oss-auto-format.sh:33`; tested by `format-hook.test.sh` | No: its only caller is dead | delete |

None of the nine is in `HOOKS_TO_COPY`, in any `commands/*.md`, `agents/`, `skills/` or `watcher/src`.

### Other findings
- `.claude-plugin/hooks/reload-context.sh` and `.claude-plugin/hooks/save-context.sh` are referenced by
  nothing at all (not even the dead hooks.json). Dead, but not part of the user's decision about the
  seven; **recorded, not deleted** — flagged to the caller.
- API repo `packages/api/src/prompts/commands/build-team.md:414-440` tells the model that the
  `team-idle.sh` / `team-task-completed.sh` hooks enforce tests/lint and reassign work. They never ran.
  That prose is now false-by-absence (it was already false). Out of scope here (API repo), flagged
  alongside the unused Telegram question/answer endpoints.
- `watcher/test/hooks/context-gate-removed.test.ts` read `.claude-plugin/hooks.json`; retargeted to the
  root file in T3. Its "no context-gate" assertion looked at `hook.command` on the group object (wrong
  nesting), so it could never fail; fixed to the nested shape while retargeting.
- `hooks/__tests__/referenced-hooks-tracked.test.sh` step 4 also read `.claude-plugin/hooks.json`
  (silenced by `2>/dev/null`); the dead path is dropped from its input list.

## Last Updated: 2026-10-19 by refactoring-specialist (T1)
