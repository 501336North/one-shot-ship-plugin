# Notes: Radical Observability G2, Phase B (plugin)

## Code map (2026-11-06, plugin c80e004)
- **oss-decision-record.sh**
  - feature resolution: L24-39;
  - uuid and ts: L65-70;
  - lock in `~/.oss/locks/<rid>`: L129-162;
  - append with a newline fix: L164-168;
  - outbox and push: L174-321 (policy GET L257, POST L289, replies L290-321).
- **oss-api-curl.sh**
  - `oss_api_curl`: L12, key on stdin;
  - `oss_ask`: L44;
  - `oss_api_creds`: L147;
  - `oss_is_regular`: L160;
  - `oss_write_atomic`: L166;
  - `oss_private_dir`: L207;
  - lock helpers: L283-300;
  - `oss_decisions_push_off`: L236.
- **oss-notify.sh**
  - the workflow block starts at L238;
  - the event switch sits inside `if [[ -f "$WORKFLOW_STATE_CLI" ]]` (L260), so the timeline call must go before it;
  - the analytics POST at L281-291 is the detached-subshell pattern to copy.
- **hooks.json** (repo root): PostToolUse has only `AskUserQuestion` (async). The new matcher is `Agent|Task`.
- **oss-value.sh**
  - `_ov_cmd_agent` (L338) is the template for a new verb;
  - new `.txt` files must join the `_ov_cmd_dir` rm list (L87-89).
- **What gets deleted:**
  - `oss-worktree-remove.sh` deletes only `.oss/{workflow-state.json,config.json,workflow.log,logs,hooks}`;
  - `oss-log.sh` touches only `.oss/logs`;
  - neither touches `.oss/dev`.
- **Version:** `.claude-plugin/plugin.json` only (2.0.97). `__tests__/plugin-version-bump.test.sh` enforces a bump.

## Gotchas
- `run_with_timeout` in oss-notify.sh must stay byte-identical to `run_bounded` in oss-session-start.sh (one-copy-helpers).
- `no-hand-capped-tests.test.sh` fails on any hand-written alarm, timeout or gtimeout in tests. Use `run_capped`.
- A new script called from served prompts via `~/.oss/hooks/` must be in `HOOKS_TO_COPY` (oss-session-start.sh L88-105) and tracked in git.

## Last Updated: 2026-11-06 by /oss:plan
