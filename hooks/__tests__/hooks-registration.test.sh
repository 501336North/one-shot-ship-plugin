#!/bin/bash
# Registration guard: only the hooks file Claude Code actually loads registers hooks, and every
# registration in it can run.
#
# @behavior Every hook the plugin registers runs for customers: its script exists and its matcher
#           is one Claude Code understands. No second, unloaded hooks file can hold registrations.
# @business-rule plugin.json "hooks" points at the ROOT hooks.json; Claude Code loads that plus
#           hooks/hooks.json, never .claude-plugin/hooks.json. Seven hooks sat for months in the
#           unloaded file with invalid `tool == "X"` matchers and never ran for anyone, while their
#           tests read a third, non-existent path and passed or failed meaninglessly.
#
# Usage: ./hooks/__tests__/hooks-registration.test.sh
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS_JSON="$ROOT/hooks.json"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; ((RUN++)); }
fail() { echo "✗ FAIL: $1 — $2"; ((RUN++)); ((FAILED++)); }

command -v jq >/dev/null 2>&1 || { echo "✗ FAIL: jq is required"; exit 1; }

# The file plugin.json points at must be the one this test reads.
manifest_hooks=$(jq -r '.hooks // empty' "$ROOT/.claude-plugin/plugin.json")
if [[ "$manifest_hooks" == "./hooks.json" ]]; then pass "plugin.json loads the root hooks.json"
else fail "plugin.json loads the root hooks.json" "plugin.json hooks = '$manifest_hooks'"; fi

# (a) no unloaded hooks file under .claude-plugin/
if [[ ! -e "$ROOT/.claude-plugin/hooks.json" ]]; then pass "(a) .claude-plugin/hooks.json does not exist (never loaded)"
else fail "(a) .claude-plugin/hooks.json does not exist" "it exists; Claude Code never loads it, so anything registered there never runs"; fi

if ! jq -e '.hooks | type == "object"' "$HOOKS_JSON" >/dev/null 2>&1; then
  fail "root hooks.json parses with a .hooks object" "unparseable or missing .hooks"
else
  # (b) every command resolves to an existing file with CLAUDE_PLUGIN_ROOT = the repo
  commands=$(jq -r '.hooks[][].hooks[]?.command' "$HOOKS_JSON")
  [[ -n "$commands" ]] || fail "(b) root hooks.json has commands" "none found"
  while IFS= read -r cmd; do
    [[ -z "$cmd" ]] && continue
    script="${cmd%% *}"
    script="${script//\$\{CLAUDE_PLUGIN_ROOT\}/$ROOT}"
    if [[ -f "$script" && -x "$script" ]]; then pass "(b) command resolves: ${cmd}"
    else fail "(b) command resolves: ${cmd}" "no executable file at $script"; fi
  done <<< "$commands"

  # (c) every matcher is empty, '*', or a tool-name list; never an expression
  matchers=$(jq -r '.hooks[][] | select(has("matcher")) | .matcher' "$HOOKS_JSON")
  bad=0
  while IFS= read -r m; do
    [[ -z "$m" || "$m" == "*" ]] && continue
    if [[ "$m" == *"=="* ]] || ! [[ "$m" =~ ^[A-Za-z0-9_\|,\ -]+$ ]]; then
      fail "(c) matcher is a tool-name list: '$m'" "not a valid Claude Code matcher"; bad=1
    fi
  done <<< "$matchers"
  [[ $bad -eq 0 ]] && pass "(c) every matcher in root hooks.json is empty, '*' or a tool-name list"
fi

# (d) scripts registered only in the unloaded file (and their only helpers) are gone
for h in oss-ask-telegram.sh oss-ask-telegram-answered.sh post-bash-pr.sh post-edit-quality.sh \
         oss-auto-format.sh team-task-completed.sh team-idle.sh \
         sse-telegram-listener.sh oss-detect-formatter.sh; do
  if [[ ! -e "$ROOT/hooks/$h" ]]; then pass "(d) unreachable hooks/$h is removed"
  else fail "(d) unreachable hooks/$h is removed" "still present; nothing loaded runs it"; fi
done

# (e) radical-observability Task 11: every picker answer reaches the decision record, without the picker
#     waiting on it. Exactly one PostToolUse entry, matching AskUserQuestion only, runs the hook async.
name='(e) hooks.json should run oss-decision-record.sh after AskUserQuestion, in the background'
got=$(jq -c '[.hooks.PostToolUse[]? | select(.hooks[]?.command | strings | endswith("/hooks/oss-decision-record.sh"))
             | {matcher, hooks}]' "$HOOKS_JSON" 2>/dev/null)
want='[{"matcher":"AskUserQuestion","hooks":[{"type":"command","command":"${CLAUDE_PLUGIN_ROOT}/hooks/oss-decision-record.sh","async":true}]}]'
if [[ "$got" == "$want" ]]; then pass "$name"; else fail "$name" "PostToolUse entries for the hook = ${got:-none}"; fi

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
