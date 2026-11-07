#!/bin/bash
# Every Agent or Task tool run adds one agent line to the feature timeline (radical-observability G2, B3).
#
# @behavior When an Agent (or Task) tool run finishes, the PostToolUse hook oss-timeline.sh appends one `agent`
#           line to the feature's .oss/dev/active/<feature>/timeline.ndjson with the agent's type and, when the
#           project's workflow-state.json names one, the running command. A built-in type such as Explore is
#           lower-cased first; a type that still fails the API pattern adds nothing. Any other tool, input that
#           is not JSON, or a refused line adds nothing, and the hook always exits 0 so no tool run is disturbed.
# @business-rule AC-G2-001.2 (an agent line per Agent tool run), P-5 (lower-case, then ^[a-z0-9:_-]{1,64}$),
#           P-8 (session from the hook's session_id, else CLAUDE_CODE_SESSION_ID, else "unknown"), state files are
#           read only when regular (never a link or a FIFO, T32), no free text reaches a line (AC-G2-001.3).
# Usage: /bin/bash hooks/__tests__/timeline-agent-hook.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TLS="$ROOT/hooks/oss-timeline.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running timeline-agent-hook tests..."

T=$(cd "$(mktemp -d /tmp/oss-timeline-agent.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.oss"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_CODE_SESSION_ID CLAUDE_PROJECT_DIR OSS_TL_SESSION

# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
source "$ROOT/hooks/__tests__/lib/run-capped.sh"   # the one time cap a test may use (T49)
API="$T/api-fake"; fake_api_install "$API"   # no config.json: nothing is sent, and any curl reaches only the fake
export PATH="$API/bin:$PATH"

# a product repo on feat/demo/build with the demo feature folder
P="$T/product"; mkdir -p "$P/.oss/dev/active/demo"
(cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/build)
TL="$P/.oss/dev/active/demo/timeline.ndjson"
WS="$P/.oss/workflow-state.json"
export CLAUDE_PROJECT_DIR="$P"

# input <tool_name> <subagent_type> [session_id] -> the PostToolUse JSON Claude Code sends
input() {
    jq -nc --arg t "$1" --arg a "$2" --arg s "${3:-}" --arg cwd "$P" '{cwd: $cwd, hook_event_name: "PostToolUse",
        tool_name: $t, tool_input: {subagent_type: $a, description: "d", prompt: "p"},
        tool_response: {content: [{type: "text", text: "done"}]}} + (if $s == "" then {} else {session_id: $s} end)'
}
# hook <stdin text> -> RC, ERR: the hook as Claude Code runs it, with no verb and the JSON on stdin
hook() {
    printf '%s' "$1" > "$T/in"
    (cd "$P" && run_capped 20 /bin/bash "$TLS" < "$T/in" > /dev/null 2> "$T/err")
    RC=$?; ERR=$(cat "$T/err")
}
lines() { local c=0; [[ -f "$TL" ]] && c=$(wc -l < "$TL" | tr -d ' '); echo "$c"; }
last() { tail -n 1 "$TL" 2>/dev/null; }

# --- the type and the running command -----------------------------------------------------------------------------
printf '{"currentCommand":"build"}\n' > "$WS"
hook "$(input Agent oss:code-reviewer hook-sess-1)"
got=$(last | jq -c '{kind, agent, command, feature, session}' 2>/dev/null)
r1="rc=$RC got=$got err=$ERR"
ok=0; [[ $RC -eq 0 && $(lines) -eq 1 && "$got" == '{"kind":"agent","agent":"oss:code-reviewer","command":"build","feature":"demo","session":"hook-sess-1"}' ]] && ok=1
export CLAUDE_CODE_SESSION_ID=cc-sess-2
hook "$(input Task oss:debugger)"
got=$(last | jq -c '{agent, command, session}' 2>/dev/null)
r2="rc=$RC got=$got err=$ERR"
[[ $RC -eq 0 && $(lines) -eq 2 && "$got" == '{"agent":"oss:debugger","command":"build","session":"cc-sess-2"}' ]] || ok=0
hook "$(input Agent oss:debugger 'bad session!')"
got=$(last | jq -r .session 2>/dev/null)
[[ $RC -eq 0 && $(lines) -eq 3 && "$got" == cc-sess-2 ]] || ok=0
unset CLAUDE_CODE_SESSION_ID
[[ $ok -eq 1 ]] && pass "should record subagent_type and the current command from workflow-state.json" \
    || fail "should record subagent_type and the current command from workflow-state.json" "$r1 | $r2 | third session=$got"

# --- P-5: lower-case, then check ----------------------------------------------------------------------------------
rm -f "$TL"
hook "$(input Agent Explore s-1)"
got=$(last | jq -r .agent 2>/dev/null); r1="rc=$RC agent=$got"
ok=0; [[ $RC -eq 0 && "$got" == explore ]] && ok=1
bad=""
for a in 'Code Reviewer' 'oss:code-reviewer;rm' "$(printf 'a%.0s' {1..65})" ''; do
    before=$(lines)
    hook "$(input Agent "$a" s-1)"
    [[ $RC -eq 0 && $(lines) -eq $before && "$(printf '%s\n' "$ERR" | grep -c .)" -le 1 ]] || bad="$bad [$a rc=$RC err=$ERR]"
done
[[ $ok -eq 1 && -z "$bad" ]] \
    && pass "should lower-case a type such as Explore before checking it, and skip a type that still fails ^[a-z0-9:_-]{1,64}$" \
    || fail "should lower-case a type such as Explore before checking it, and skip a type that still fails ^[a-z0-9:_-]{1,64}$" "$r1$bad"

# --- no command: missing, linked, a FIFO, or not a command name ----------------------------------------------------
bad=""
check_no_command() { # <case>
    hook "$(input Agent oss:code-reviewer s-1)"
    local l; l=$(last)
    [[ $RC -eq 0 && $(printf '%s' "$l" | jq -r '.agent + "|" + (has("command") | tostring)' 2>/dev/null) == "oss:code-reviewer|false" ]] \
        || bad="$bad [$1 rc=$RC line=$l err=$ERR]"
    rm -f "$TL"
}
rm -f "$WS" "$TL"; check_no_command missing
printf '{"currentCommand":"ship"}\n' > "$T/elsewhere.json"; ln -s "$T/elsewhere.json" "$WS"; check_no_command symlink
rm -f "$WS"; mkfifo "$WS"; check_no_command fifo
for c in 'Build' 'x y' 'build;rm' "$(printf 'a%.0s' {1..42})"; do
    rm -f "$WS"; jq -nc --arg c "$c" '{currentCommand: $c}' > "$WS"; check_no_command "command=$c"
done
rm -f "$WS"; printf '{"currentCommand":42}\n' > "$WS"; check_no_command number
rm -f "$WS"; printf 'not json\n' > "$WS"; check_no_command "not json"
[[ -z "$bad" ]] && pass "should omit command when workflow-state.json is missing, a symlink, or names an invalid command" \
    || fail "should omit command when workflow-state.json is missing, a symlink, or names an invalid command" "$bad"
printf '{"currentCommand":"build"}\n' > "$WS"

# --- nothing for other tools or other input -----------------------------------------------------------------------
rm -f "$TL"; bad=""
for t in Bash AskUserQuestion Agents Task2 ''; do
    hook "$(input "$t" oss:code-reviewer s-1)"
    [[ $RC -eq 0 && ! -e "$TL" ]] || bad="$bad [$t rc=$RC]"
done
[[ -z "$bad" ]] && pass "should do nothing for any other tool_name" || fail "should do nothing for any other tool_name" "$bad"

bad=""
for s in 'not json' '' '[1,2]' '{"tool_name":"Agent"}' '{"tool_name":"Agent","tool_input":"oss:x"}'; do
    hook "$s"
    [[ $RC -eq 0 && ! -e "$TL" ]] || bad="$bad [$s rc=$RC err=$ERR]"
done
[[ -z "$bad" ]] && pass "should do nothing on stdin that is not JSON, and exit 0" \
    || fail "should do nothing on stdin that is not JSON, and exit 0" "$bad"

# --- exit 0 in every case: a refused line, and no .oss folder -----------------------------------------------------
ln -s "$T/elsewhere.ndjson" "$TL"
hook "$(input Agent oss:code-reviewer s-1)"
r1="rc=$RC outside=$( [[ -e "$T/elsewhere.ndjson" ]] && echo written || echo none)"
ok=0; [[ $RC -eq 0 && ! -e "$T/elsewhere.ndjson" && "$ERR" == "oss: "* ]] && ok=1
rm -f "$TL"
Q="$T/plain"; mkdir -p "$Q"; (cd "$Q" && git init -q)
(cd "$Q" && CLAUDE_PROJECT_DIR="$Q" run_capped 20 /bin/bash "$TLS" <<< "$(input Agent oss:code-reviewer s-1)" > /dev/null 2> "$T/err")
r2="plain rc=$? err=$(cat "$T/err") $(ls -A "$Q")"
[[ "$r2" == "plain rc=0 err= .git" ]] || ok=0
[[ $ok -eq 1 ]] && pass "should exit 0 when the line is refused or the project never used OSS" \
    || fail "should exit 0 when the line is refused or the project never used OSS" "$r1 | $r2"

# --- an unknown verb is still a usage error -----------------------------------------------------------------------
(cd "$P" && run_capped 20 /bin/bash "$TLS" bogus < /dev/null > /dev/null 2> "$T/err"); RC=$?
[[ $RC -eq 2 && "$(cat "$T/err")" == usage:* && ! -e "$TL" ]] && pass "should give usage and exit 2 for an unknown verb" \
    || fail "should give usage and exit 2 for an unknown verb" "rc=$RC err=$(cat "$T/err")"

echo ""
echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
