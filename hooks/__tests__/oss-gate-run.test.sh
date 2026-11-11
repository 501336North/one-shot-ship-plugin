#!/bin/bash
# Gate-run hook wiring: a review agent's run is checked for repo changes (R-266, US-008, ADR-009).
#
# @behavior When a review agent starts, the repo is recorded; when it ends, a change is reported to
#           the user; when the main agent gets the review's result, it is told the review is void.
#           Claude Code runs hooks/oss-gate-run.sh for SubagentStart, SubagentStop and the Agent
#           PostToolUse, which runs the shipped bundle watcher/dist/cli/gate-run.cjs with the event.
#           A failure of the check itself never blocks the session: the run is allowed and the agent
#           is told the review could not be checked.
# @business-rule A review is only worth something if the code it judged is the code that ships.
#
# Usage: ./hooks/__tests__/oss-gate-run.test.sh   (needs jq, git, node)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK CLAUDE_PROJECT_DIR
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS_JSON="$ROOT/hooks.json"
HOOK="$ROOT/hooks/oss-gate-run.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; ((RUN++)); }
fail() { echo "✗ FAIL: $1 — $2"; ((RUN++)); ((FAILED++)); }

command -v jq >/dev/null 2>&1 || { echo "✗ FAIL: jq is required"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- hooks.json: three synchronous entries, timeout 10 ---------------------------------------
entry() { # event matcher-or-empty arg
    jq -c --arg ev "$1" --arg m "$2" --arg cmd "\${CLAUDE_PLUGIN_ROOT}/hooks/oss-gate-run.sh $3" '
      [.hooks[$ev][]? | select((.matcher // "") == $m) | .hooks[] | select(.command == $cmd)]' "$HOOKS_JSON"
}
check_entry() { # event matcher arg label
    local found
    found="$(entry "$1" "$2" "$3")"
    if [[ "$(jq 'length' <<<"$found")" == 1 && "$(jq '.[0].timeout' <<<"$found")" == 10 &&
          "$(jq '.[0].async // false' <<<"$found")" == false ]]; then
        pass "hooks.json: $4 runs oss-gate-run.sh $3 (timeout 10, not async)"
    else
        fail "hooks.json: $4 runs oss-gate-run.sh $3 (timeout 10, not async)" "found: $found"
    fi
}
check_entry SubagentStart "" subagent-start "SubagentStart"
check_entry SubagentStop "" subagent-stop "SubagentStop"
check_entry PostToolUse "Agent|Task" agent-post "PostToolUse Agent|Task"
if [[ "$(jq '[.hooks.PostToolUse[] | select(.matcher == "Agent|Task") | .hooks[] | select(.command | endswith("oss-timeline.sh")) | select(.async == true)] | length' "$HOOKS_JSON")" == 1 ]]; then
    pass "hooks.json: the async timeline hook on Agent|Task is kept"
else
    fail "hooks.json: the async timeline hook on Agent|Task is kept" "missing or changed"
fi

# --- the real hook and bundle, end to end, CLAUDE_PROJECT_DIR unset --------------------------
REPO="$TMP/repo"
mkdir -p "$REPO/src/deep"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.name "Gate Run Hook Test"
git -C "$REPO" config user.email gate-run-hook-test@example.com
git -C "$REPO" config commit.gpgsign false
printf 'export const a = 1;\n' > "$REPO/src/app.ts"
git -C "$REPO" add -A && git -C "$REPO" commit -q -m initial
run_hook() { # event json  (run from a subfolder of the repo, as a subagent's cwd can be)
    (cd "$REPO/src/deep" && CLAUDE_PLUGIN_ROOT="$ROOT" "$HOOK" "$1" <<<"$2")
}
SUB="$REPO/src/deep"
start_json="{\"session_id\":\"s1\",\"cwd\":\"$SUB\",\"hook_event_name\":\"SubagentStart\",\"agent_id\":\"hook-a\",\"agent_type\":\"oss:code-reviewer\"}"
stop_json="{\"session_id\":\"s1\",\"cwd\":\"$SUB\",\"hook_event_name\":\"SubagentStop\",\"agent_id\":\"hook-a\",\"agent_type\":\"oss:code-reviewer\"}"
post_json="{\"session_id\":\"s1\",\"cwd\":\"$SUB\",\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Agent\",\"tool_response\":{\"agentId\":\"hook-a\"}}"

out="$(run_hook subagent-start "$start_json")"; rc=$?
if [[ $rc == 0 && -z "$out" ]]; then pass "subagent-start: exit 0, says nothing"
else fail "subagent-start: exit 0, says nothing" "rc=$rc out=$out"; fi

printf 'export const a = 2;\n' > "$REPO/src/app.ts"
out="$(run_hook subagent-stop "$stop_json")"; rc=$?
if [[ $rc == 0 ]] && jq -e '.systemMessage | test("void"; "i") and contains("src/app.ts")' <<<"$out" >/dev/null 2>&1; then
    pass "subagent-stop: the repo is found from cwd without CLAUDE_PROJECT_DIR and the change is reported"
else
    fail "subagent-stop: the repo is found from cwd without CLAUDE_PROJECT_DIR and the change is reported" "rc=$rc out=$out"
fi

out="$(run_hook agent-post "$post_json")"; rc=$?
if [[ $rc == 0 ]] && jq -e '.hookSpecificOutput.hookEventName == "PostToolUse" and (.hookSpecificOutput.additionalContext | test("stop the ship"; "i"))' <<<"$out" >/dev/null 2>&1; then
    pass "agent-post: the main agent is told the review is void"
else
    fail "agent-post: the main agent is told the review is void" "rc=$rc out=$out"
fi

# --- a broken CLI never blocks: allow, tell -----------------------------------------------------
STUB_ROOT="$TMP/plugin"
mkdir -p "$STUB_ROOT/watcher/dist/cli" "$STUB_ROOT/hooks"
cp "$HOOK" "$STUB_ROOT/hooks/oss-gate-run.sh"
printf 'process.stdout.write(process.argv[2] + "\\n");\n' > "$STUB_ROOT/watcher/dist/cli/gate-run.cjs"
out="$(cd "$REPO" && CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" subagent-stop <<<"{}")"; rc=$?
if [[ $rc == 0 && "$out" == subagent-stop ]]; then pass "the hook hands the event name to the CLI"
else fail "the hook hands the event name to the CLI" "rc=$rc out=$out"; fi

printf 'process.exit(1);\n' > "$STUB_ROOT/watcher/dist/cli/gate-run.cjs"
out="$(cd "$REPO" && CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" subagent-stop <<<"{}")"; rc=$?
if [[ $rc == 0 ]] && jq -e '.systemMessage | test("could not"; "i")' <<<"$out" >/dev/null 2>&1; then
    pass "a failing CLI: exit 0 and the user is told the review check could not run"
else
    fail "a failing CLI: exit 0 and the user is told the review check could not run" "rc=$rc out=$out"
fi

echo "Ran $RUN checks, $FAILED failed"
[[ $FAILED -eq 0 ]]
