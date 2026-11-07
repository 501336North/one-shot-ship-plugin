#!/bin/bash
# A feature's key events are kept in its committed timeline and copied to the OSS API.
#
# @behavior During a build and a ship, the feature folder's timeline.ndjson gains one line per key event:
#           a command line for each start, complete and failed; an agent line for each Agent tool run; a gate
#           line for each ship gate, read from value files only; a merge line whose PR facts come from GitHub
#           (`gh`), with the approval from a value file. Each line is copied to the API in the background,
#           in the exact shape the API accepts. A team that opted out still gets the repo copy, and nothing
#           is sent.
# @business-rule radical-observability G2 (US-G2-001, 002, 003, 005; plugin Phase B, PLAN.md Task 1): lines are
#           structured fields only, never free text; values reach the gate and merge verbs only through value
#           files; the push obeys the team policy the same way decisions do (AC-G2-005.2).
#
# The REAL hooks run from a sandbox copy of this checkout (no watcher/dist, so a built watcher cannot change
# what is tested), with a sandbox HOME whose OSS config points at a fake API (fake-oss-api.sh) and a fake `gh`.
# Usage: ./hooks/__tests__/timeline.acceptance.test.sh
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
# The fake API (fake-oss-api.sh) stands at a plain-http loopback apiUrl: that needs the opt-in (T20).
export OSS_ALLOW_HTTP_LOOPBACK=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
# shellcheck source=hooks/__tests__/lib/run-capped.sh
source "$ROOT/hooks/__tests__/lib/run-capped.sh"

T=$(cd "$(mktemp -d /tmp/oss-timeline-acc.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR
export CLAUDE_CODE_SESSION_ID=acc-session-1
export HOME="$T/home"; mkdir -p "$HOME/.oss"
PLUGIN="$T/plugin"; mkdir -p "$PLUGIN"; cp -R "$ROOT/hooks" "$PLUGIN/hooks"; cp "$ROOT/hooks.json" "$PLUGIN/hooks.json"
export CLAUDE_PLUGIN_ROOT="$PLUGIN"
# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
API="$T/api"; fake_api_install "$API"
# a fake gh: the merged PR's facts, and a record of every argv it was given
mkdir -p "$T/gh/bin"
cat > "$T/gh/bin/gh" << 'GH'
#!/bin/bash
printf '%s\n' "$*" >> "$(dirname "$0")/../argv"
[[ "$1 $2" == "pr view" ]] || exit 1
printf '%s\n' '{"number":4242,"state":"MERGED","mergeCommit":{"oid":"0123456789abcdef0123456789abcdef01234567"},"mergedAt":"2026-11-06T09:30:00Z","mergedBy":{"login":"octo-dev"}}'
GH
chmod +x "$T/gh/bin/gh"
export PATH="$T/gh/bin:$API/bin:$PATH"
printf '{"apiKey":"%s","apiUrl":"http://127.0.0.1:9"}\n' 'fake-oss-key-timeline-0000' > "$HOME/.oss/config.json"

# product repo P on feat/demo/build, with the feature folder; Q for the opted-out team
repo() {
    mkdir -p "$1/.oss/dev/active/demo"
    (cd "$1" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/build)
    printf '{"currentCommand":"ship"}\n' > "$1/.oss/workflow-state.json"
}
P="$T/product"; repo "$P"
TL="$P/.oss/dev/active/demo/timeline.ndjson"
lines() { jq -c "select(.kind == \"$2\")" "$1" 2>/dev/null; }
# wait until the background push has sent N timeline bodies (bounded: 10 s)
sent() { grep -c '^timeline ' "$API/api/calls" 2>/dev/null || echo 0; }
await_sent() { local i; for i in $(seq 1 100); do [[ $(sent) -ge $1 ]] && return 0; sleep 0.1; done; return 1; }

notify() { (cd "$1" && CLAUDE_PROJECT_DIR="$1" run_capped 20 /bin/bash "$PLUGIN/hooks/oss-notify.sh" --workflow build "$2" '{}' > /dev/null 2>&1); }
# the PostToolUse command hooks.json registers for the Agent tool, as Claude Code runs it
AGENT_CMD=$(jq -r '.hooks.PostToolUse[] | select(.matcher | split("|") | index("Agent")) | .hooks[0].command' "$PLUGIN/hooks.json" 2>/dev/null)
AGENT_CMD=${AGENT_CMD//\$\{CLAUDE_PLUGIN_ROOT\}/$PLUGIN}
agent_run() {
    jq -nc --arg cwd "$1" '{session_id: "acc-session-1", cwd: $cwd, hook_event_name: "PostToolUse", tool_name: "Agent",
        tool_input: {subagent_type: "oss:code-reviewer", description: "Review the diff", prompt: "Review it"},
        tool_response: {content: [{type: "text", text: "LGTM"}]}}' > "$T/agent.json"
    (cd "$1" && CLAUDE_PROJECT_DIR="$1" run_capped 20 /bin/bash -c "$AGENT_CMD" < "$T/agent.json" > /dev/null 2>&1)
}
value_dir() { (cd "$1" && CLAUDE_PROJECT_DIR="$1" "$PLUGIN/hooks/oss-value.sh" dir 2>/dev/null); }
gate_run() {
    local d; d=$(value_dir "$1")
    [[ -d "$d" ]] || return 1
    printf '2\n' > "$d/round.txt"; printf 'code-review\n' > "$d/gate.txt"; printf 'fail\n' > "$d/verdict.txt"
    printf 'critical=0 high=2 low=1\n' > "$d/findings.txt"; printf 'high=1\n' > "$d/fixed.txt"; printf 'full\n' > "$d/mode.txt"
    (cd "$1" && CLAUDE_PROJECT_DIR="$1" run_capped 20 "$PLUGIN/hooks/oss-value.sh" timeline gate > /dev/null 2>&1)
}
merge_run() {
    local d; d=$(value_dir "$1")
    [[ -d "$d" ]] || return 1
    printf 'merge-flag\n' > "$d/approval.txt"
    (cd "$1" && CLAUDE_PROJECT_DIR="$1" run_capped 20 "$PLUGIN/hooks/oss-value.sh" timeline merge > /dev/null 2>&1)
}

# --- one build and one ship on feature "demo" -------------------------------------------------------------------
notify "$P" start; notify "$P" complete; notify "$P" failed
agent_run "$P"
gate_run "$P"
merge_run "$P"

got=$(lines "$TL" command | jq -sc '[.[] | {command, status, feature}]')
[[ "$got" == '[{"command":"build","status":"start","feature":"demo"},{"command":"build","status":"complete","feature":"demo"},{"command":"build","status":"failed","feature":"demo"}]' ]] \
    && pass "oss-notify start, complete and failed each append one command line to the feature's timeline" \
    || fail "oss-notify start, complete and failed each append one command line to the feature's timeline" "got $got; file=$(cat "$TL" 2>/dev/null)"

got=$(lines "$TL" agent | jq -sc '[.[] | {agent, command}]')
[[ "$got" == '[{"agent":"oss:code-reviewer","command":"ship"}]' ]] \
    && pass "an Agent tool run appends one agent line with its type and the running command" \
    || fail "an Agent tool run appends one agent line with its type and the running command" "got $got (hook command: ${AGENT_CMD:-none registered})"

got=$(lines "$TL" gate | jq -sc '[.[] | {round, gate, verdict, findings, fixed, mode}]')
[[ "$got" == '[{"round":2,"gate":"code-review","verdict":"fail","findings":{"critical":0,"high":2,"low":1},"fixed":{"high":1},"mode":"full"}]' ]] \
    && pass "a ship gate appends one gate line built from value files" \
    || fail "a ship gate appends one gate line built from value files" "got $got"

got=$(lines "$TL" merge | jq -sc '[.[] | {pr, sha, mergedAt, mergedBy, approval}]')
[[ "$got" == '[{"pr":4242,"sha":"0123456789abcdef0123456789abcdef01234567","mergedAt":"2026-11-06T09:30:00Z","mergedBy":"octo-dev","approval":{"type":"merge-flag"}}]' ]] \
    && pass "the merge appends one merge line with GitHub's facts and the approval from a value file" \
    || fail "the merge appends one merge line with GitHub's facts and the approval from a value file" "got $got"

bad=$(jq -c 'select((.v == 1 and (.id | test("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"))
        and (.ts | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$")) and .session == "acc-session-1") | not)' "$TL" 2>/dev/null)
n=0; [[ -f "$TL" ]] && n=$(jq -s 'length' "$TL" 2>/dev/null)
[[ "$n" == 6 && -z "$bad" ]] && pass "every line has v 1, a lower-case uuid v4 id, an ISO UTC time and the session" \
    || fail "every line has v 1, a lower-case uuid v4 id, an ISO UTC time and the session" "lines=$n bad=$bad"

# --- the copy to the API ----------------------------------------------------------------------------------------
await_sent 6
# the exact key sets the API's strict schema accepts per kind (AgenticDevWorkflow services/timeline/schema.ts);
# keyFp and repo are optional there
shape='def keys_ok($want): (keys - ["keyFp", "repo"]) == ($want | sort);
    if .kind == "command" then keys_ok(["v","id","ts","kind","feature","session","command","status"])
    elif .kind == "agent" then keys_ok(["v","id","ts","kind","feature","session","agent","command"])
    elif .kind == "gate" then keys_ok(["v","id","ts","kind","feature","session","round","gate","verdict","findings","fixed","mode"])
    elif .kind == "merge" then keys_ok(["v","id","ts","kind","feature","session","pr","sha","mergedAt","mergedBy","approval"])
    else false end'
ids_sent=$(grep -h . "$API"/api/body.* 2>/dev/null | jq -sc '[.[].id] | sort')
ids_kept=$(jq -sc '[.[].id] | sort' "$TL" 2>/dev/null)
off_shape=$(cat "$API"/api/body.* 2>/dev/null | jq -c "select(($shape) | not) | .kind" 2>/dev/null)
[[ $(sent) -eq 6 && "$ids_sent" == "$ids_kept" && -z "$off_shape" ]] \
    && pass "every line is copied to POST /api/v1/timeline once, in the exact shape the API accepts" \
    || fail "every line is copied to POST /api/v1/timeline once, in the exact shape the API accepts" "posts=$(sent) sent=$ids_sent kept=$ids_kept off-shape=$off_shape"

leak=$(cat "$API"/api/argv.* "$T/gh/argv" 2>/dev/null | grep -E 'critical=|merge-flag|fake-oss-key-timeline' | head -n 2)
[[ -z "$leak" && -s "$T/gh/argv" ]] && pass "no gate value, approval or API key ever appears on a command line" \
    || fail "no gate value, approval or API key ever appears on a command line" "leak=$leak gh-called=$([[ -s "$T/gh/argv" ]] && echo yes || echo no)"

# --- a team that opted out --------------------------------------------------------------------------------------
Q="$T/optout"; repo "$Q"
before=$(sent)
policy_calls() { grep -c '^policy ' "$API/api/calls" 2>/dev/null || echo 0; }
asked=$(policy_calls)
for _ in 1 2 3 4 5; do echo '200 {"pushEnabled":false,"team":true}' >> "$API/api/queue.policy"; done
notify "$Q" start
# the push ran (it asked the team policy) and then sent nothing (bounded: 10 s)
for _ in $(seq 1 100); do [[ $(policy_calls) -gt $asked ]] && break; sleep 0.1; done
QL="$Q/.oss/dev/active/demo/timeline.ndjson"
[[ $(lines "$QL" command | wc -l | tr -d ' ') == 1 && $(policy_calls) -gt $asked && $(sent) == "$before" ]] \
    && pass "an opted-out team still gets the repo line, and nothing is sent to the API" \
    || fail "an opted-out team still gets the repo line, and nothing is sent to the API" "lines=$(cat "$QL" 2>/dev/null) policy-asked=$(($(policy_calls) - asked)) posts-before=$before posts-after=$(sent)"

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
