#!/bin/bash
# The feature timeline gets one checked line per event, in the shape the API accepts (radical-observability G2, B1).
#
# @behavior When OSS records a command, an agent run, a gate or a merge, one line is appended to the feature's
#           committed .oss/dev/active/<feature>/timeline.ndjson (or .oss/dev/timeline-unfiled.ndjson when no feature
#           folder resolves). Every line carries v 1, a lower-case uuid v4 id, an ISO UTC time, its kind, the
#           feature and the session. A value outside the API's pattern for its field, a linked or hard-linked file,
#           or a linked feature folder writes nothing. Two sessions appending at once both keep their line; a
#           session that cannot get the lock in 10 s gives up rather than block.
# @business-rule AC-G2-001.3 (no free text: every field a closed pattern, the API's strict schema), AC-G2-001.5 (no
#           write through a link), P-3 (unfiled lines carry no feature and are never pushed), P-8 (session from the
#           hook input, else CLAUDE_CODE_SESSION_ID, else "unknown"), the G1 lock in ~/.oss/locks.
# Usage: /bin/bash hooks/__tests__/timeline-writer.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TLS="$ROOT/hooks/oss-timeline.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running timeline-writer tests..."

T=$(cd "$(mktemp -d /tmp/oss-timeline-writer.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.oss"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_CODE_SESSION_ID CLAUDE_PROJECT_DIR OSS_TL_SESSION

# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
source "$ROOT/hooks/__tests__/lib/run-capped.sh"   # the one time cap a test may use (T49)
API="$T/api-fake"; fake_api_install "$API"   # the writer makes no network call; any curl would reach only the fake
export PATH="$API/bin:$PATH"

# new_project <branch> [active folder...] -> P, a product repo on <branch>; TL its demo timeline, UN the unfiled one
new_project() {
    local b="$1" f; shift
    P=$(mktemp -d "$T/p.XXXXXX"); mkdir -p "$P/.oss/dev/active"
    for f in "$@"; do mkdir -p "$P/.oss/dev/active/$f"; done
    (cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -B "$b")
    export CLAUDE_PROJECT_DIR="$P"
    TL="$P/.oss/dev/active/demo/timeline.ndjson"; UN="$P/.oss/dev/timeline-unfiled.ndjson"
}
# append <kind> <fields json> -> RC, ERR (stderr): the writer, sourced in a subshell, as a later verb calls it
append() {
    run_capped 30 /bin/bash -c 'source "$1" || exit 99; oss_timeline_append "$2" "$3"' _ "$TLS" "$1" "$2" 2>"$T/err"
    RC=$?; ERR=$(cat "$T/err")
}
lines() { local c=0; [[ -f "$1" ]] && c=$(wc -l < "$1" | tr -d ' '); echo "$c"; }
last() { tail -n 1 "$1" 2>/dev/null; }
# the rid of a file (the G1 lock name): 16 hex of the sha-256 of its physical path
rid_of() { printf '%s' "$1" | shasum -a 256 | cut -c1-16; }

UUID4='^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
ISO='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$'
# the exact keys the API's strict schema allows per kind (repo and keyFp are optional there; the writer adds neither)
KEYS='{"command":["command","feature","id","kind","session","status","ts","v"],
  "agent":["agent","command","feature","id","kind","session","ts","v"],
  "gate":["feature","findings","fixed","gate","id","kind","mode","round","session","ts","v","verdict"],
  "merge":["approval","feature","id","kind","mergedAt","mergedBy","pr","session","sha","ts","v"],
  "merge-unknown":["feature","id","kind","pr","session","ts","v"]}'
CMD='{"command":"build","status":"start"}'
AGENT='{"agent":"oss:code-reviewer","command":"build"}'
GATE='{"round":1,"gate":"code-review","verdict":"pass","findings":{"high":2,"low":1},"fixed":{"high":2},"mode":"full"}'
MERGE='{"pr":42,"sha":"0123456789abcdef0123456789abcdef01234567","mergedAt":"2026-11-06T10:00:00Z","mergedBy":"octo-cat","approval":{"type":"merge-flag"}}'
MUNK='{"pr":42}'

# --- every line: the base fields ----------------------------------------------------------------------------------
new_project feat/demo/build demo
export CLAUDE_CODE_SESSION_ID=cc-session-1
ok=1; why=""
for k in command agent gate merge merge-unknown; do
    case $k in command) f=$CMD ;; agent) f=$AGENT ;; gate) f=$GATE ;; merge) f=$MERGE ;; merge-unknown) f=$MUNK ;; esac
    append "$k" "$f"
    l=$(last "$TL")
    good=$(printf '%s' "$l" | jq -r --arg k "$k" --arg u "$UUID4" --arg iso "$ISO" --argjson keys "$KEYS" --argjson f "$f" '
        .v == 1 and (.id | test($u)) and (.ts | test($iso)) and .kind == $k and .feature == "demo"
        and .session == "cc-session-1" and (keys == $keys[$k]) and (. as $l | $f | to_entries | all(.value == $l[.key]))' 2>/dev/null)
    [[ $RC -eq 0 && "$good" == true ]] || { ok=0; why="$why $k(rc=$RC line=$l err=$ERR)"; }
done
[[ $ok -eq 1 && $(lines "$TL") -eq 5 ]] \
    && pass "should write v 1, a lower-case uuid v4 id, an ISO UTC ts, kind, feature and session on every line" \
    || fail "should write v 1, a lower-case uuid v4 id, an ISO UTC ts, kind, feature and session on every line" "lines=$(lines "$TL")$why"
ids=$(jq -r .id "$TL" 2>/dev/null | sort -u | wc -l | tr -d ' ')
[[ "$ids" == 5 ]] && pass "should give every line its own id" || fail "should give every line its own id" "distinct=$ids"
append merge-unknown '{}'
[[ $RC -eq 0 && $(last "$TL" | jq -c 'keys') == '["feature","id","kind","session","ts","v"]' ]] \
    && pass "should write a merge-unknown line with the base fields only when no pr is known" \
    || fail "should write a merge-unknown line with the base fields only when no pr is known" "rc=$RC line=$(last "$TL") err=$ERR"
[[ ! -f "$API/api/calls" ]] && pass "should make no network call while writing" || fail "should make no network call while writing" "$(cat "$API/api/calls")"

# --- the session (P-8) --------------------------------------------------------------------------------------------
# session_case <name> <OSS_TL_SESSION or -> <CLAUDE_CODE_SESSION_ID or -> <want>
session_case() {
    rm -f "$TL"
    if [[ "$2" == - ]]; then unset OSS_TL_SESSION; else export OSS_TL_SESSION="$2"; fi
    if [[ "$3" == - ]]; then unset CLAUDE_CODE_SESSION_ID; else export CLAUDE_CODE_SESSION_ID="$3"; fi
    append command "$CMD"
    got=$(last "$TL" | jq -r .session 2>/dev/null)
    [[ $RC -eq 0 && "$got" == "$4" ]] && pass "session: $1" || fail "session: $1" "rc=$RC got=$got want=$4 err=$ERR"
}
ZW=$(printf 'cc-\xe2\x80\x8b1')   # U+200B, a zero-width space
session_case "should take the hook input's session_id first" hook-sid-1 cc-session-1 hook-sid-1
session_case "should take CLAUDE_CODE_SESSION_ID when no hook input is passed" - cc-session-1 cc-session-1
session_case "should write \"unknown\" when neither is set" - - unknown
session_case "should skip a hook session_id outside the pattern and take CLAUDE_CODE_SESSION_ID" 'bad id;x' cc-session-1 cc-session-1
session_case "should write \"unknown\" for a 65-character CLAUDE_CODE_SESSION_ID" - "$(printf 'a%.0s' {1..65})" unknown
session_case "should write \"unknown\" for a session holding U+200B" - "$ZW" unknown
session_case "should write \"unknown\" for a session holding a newline" $'hook\nsid' - unknown
unset OSS_TL_SESSION; export CLAUDE_CODE_SESSION_ID=cc-session-1

# --- unfiled (P-3) ------------------------------------------------------------------------------------------------
new_project feat/missing/build demo
append command "$CMD"
[[ $RC -eq 0 && $(lines "$UN") -eq 1 && $(last "$UN" | jq -r 'has("feature")') == false && ! -e "$TL" ]] \
    && pass "should write to .oss/dev/timeline-unfiled.ndjson with feature omitted when no feature folder resolves" \
    || fail "should write to .oss/dev/timeline-unfiled.ndjson with feature omitted when no feature folder resolves" \
        "rc=$RC unfiled=$(cat "$UN" 2>/dev/null) err=$ERR"
[[ ! -f "$API/api/calls" && ! -e "$HOME/.oss/timeline-outbox" ]] && pass "should never queue or send an unfiled line" \
    || fail "should never queue or send an unfiled line" "calls=$(cat "$API/api/calls" 2>/dev/null)"

# --- refusals: links ----------------------------------------------------------------------------------------------
# refused <name> <file that must stay as it is> <outside file that must stay empty>
refused() {
    [[ $RC -ne 0 && "$ERR" == "oss: "* && "$(printf '%s\n' "$ERR" | grep -c .)" -eq 1 && ! -s "$3" ]] && pass "$1" \
        || fail "$1" "rc=$RC err=$ERR outside=$(cat "$3" 2>/dev/null)"
}
new_project feat/demo/build demo
: > "$T/outside.ndjson"; ln -s "$T/outside.ndjson" "$TL"
append command "$CMD"
refused "should refuse a symlinked timeline.ndjson and write nothing" "$TL" "$T/outside.ndjson"

new_project feat/demo/build
mkdir -p "$T/outside-dir"; ln -s "$T/outside-dir" "$P/.oss/dev/active/demo"
append command "$CMD"
refused "should refuse a symlinked feature folder and write nothing" "$TL" "$T/outside-dir/timeline.ndjson"
[[ ! -e "$UN" ]] && pass "should not file a refused line as unfiled instead" || fail "should not file a refused line as unfiled instead" "$(cat "$UN")"

new_project feat/demo/build demo
: > "$TL"; ln "$TL" "$P/other.ndjson"
append command "$CMD"
refused "should refuse a timeline.ndjson with more than one hard link" "$TL" "$P/other.ndjson"

# --- the newline fix ----------------------------------------------------------------------------------------------
new_project feat/demo/build demo
printf '%s' '{"cut":"short"}' > "$TL"
append command "$CMD"
[[ $RC -eq 0 && $(lines "$TL") -eq 2 && "$(head -n 1 "$TL")" == '{"cut":"short"}' && $(last "$TL" | jq -r .kind) == command ]] \
    && pass "should add a newline first when the file does not end in one" \
    || fail "should add a newline first when the file does not end in one" "rc=$RC file=$(cat "$TL") err=$ERR"

# --- the lock -----------------------------------------------------------------------------------------------------
new_project feat/demo/build demo
run_capped 40 /bin/bash -c 'source "$1"; oss_timeline_append command "$2"' _ "$TLS" "$CMD" 2>/dev/null & a=$!
run_capped 40 /bin/bash -c 'source "$1"; oss_timeline_append command "$2"' _ "$TLS" "$CMD" 2>/dev/null & b=$!
wait $a; ra=$?; wait $b; rb=$?
d=$(jq -r .id "$TL" 2>/dev/null | sort -u | wc -l | tr -d ' ')
[[ $ra -eq 0 && $rb -eq 0 && $(lines "$TL") -eq 2 && "$d" == 2 ]] \
    && pass "should keep both lines when two sessions append at once" \
    || fail "should keep both lines when two sessions append at once" "rc=$ra/$rb lines=$(lines "$TL") ids=$d"

new_project feat/demo/build demo
mkdir -p "$HOME/.oss/locks"; L="$HOME/.oss/locks/$(rid_of "$TL")"; mkdir "$L"
s=$SECONDS; append command "$CMD"; e=$((SECONDS - s))
rmdir "$L" 2>/dev/null
[[ $RC -ne 0 && $RC -ne $RUN_CAPPED_CAP_RC && $e -ge 9 && $e -le 14 && $(lines "$TL") -eq 0 && "$ERR" == *locked* ]] \
    && pass "should skip after 10 s when another session holds the lock, and never wait longer" \
    || fail "should skip after 10 s when another session holds the lock, and never wait longer" "rc=$RC waited=${e}s lines=$(lines "$TL") err=$ERR"

# --- refusals: values outside the API pattern ---------------------------------------------------------------------
new_project feat/demo/build demo
U=$(printf '\\u200b')   # U+200B as a JSON escape
H40=0123456789abcdef0123456789abcdef01234567
# sub <json> <from> <to>: the json with the first <from> replaced, literally
# (the replacement unquoted: bash 3.2 keeps the quotes of a quoted one)
sub() { local f=$2 t=$3; printf '%s' "${1/"$f"/$t}"; }
A65=$(printf 'a%.0s' {1..65}); A40=$(printf 'a%.0s' {1..40})
MF='{"type":"merge-flag"}'
ROWS=(
    "deploy|$CMD"
    'command|not json'
    'command|["build","start"]'
    'command|{"command":"Build","status":"start"}'
    'command|{"command":"build;rm","status":"start"}'
    "command|{\"command\":\"build$U\",\"status\":\"start\"}"
    'command|{"command":"build","status":"done"}'
    'command|{"command":"build"}'
    'command|{"command":"build","status":"start","note":"x"}'
    'command|{"command":"build","status":"start","id":"00000000-0000-4000-8000-000000000000"}'
    'command|{"command":"build","status":"start","session":"forged"}'
    'command|{"command":"build","status":"start","feature":"other"}'
    'command|{"command":"build","status":"start","repo":"a/b"}'
    'agent|{"agent":"Oss:Reviewer"}'
    "agent|{\"agent\":\"$A65\"}"
    'agent|{"agent":"oss:code reviewer"}'
    "agent|{\"agent\":\"oss:code-reviewer$U\"}"
    'agent|{"agent":"oss:code-reviewer","command":"x y"}'
    'agent|{"command":"build"}'
    "gate|$(sub "$GATE" '"round":1' '"round":0')"
    "gate|$(sub "$GATE" '"round":1' '"round":21')"
    "gate|$(sub "$GATE" '"round":1' '"round":1.5')"
    "gate|$(sub "$GATE" '"round":1' '"round":"1"')"
    "gate|$(sub "$GATE" code-review Code_Review)"
    "gate|$(sub "$GATE" '"pass"' '"ok"')"
    "gate|$(sub "$GATE" '"full"' '"fast"')"
    "gate|$(sub "$GATE" '"high":2,' '"high":-1,')"
    "gate|$(sub "$GATE" '"low":1' '"low":1001')"
    "gate|$(sub "$GATE" '"low":1' '"bogus":1')"
    "gate|$(sub "$GATE" '"fixed":{"high":2}' '"fixed":[]')"
    'gate|{"round":1,"gate":"code-review","verdict":"pass","findings":{},"mode":"full"}'
    "merge|$(sub "$MERGE" '"pr":42' '"pr":0')"
    "merge|$(sub "$MERGE" '"pr":42' '"pr":10000001')"
    "merge|$(sub "$MERGE" "$H40" 0123456789ABCDEF0123456789ABCDEF01234567)"
    "merge|$(sub "$MERGE" "$H40" 0123456)"
    "merge|$(sub "$MERGE" 2026-11-06T10:00:00Z 2019-12-31T23:59:59Z)"
    "merge|$(sub "$MERGE" 2026-11-06T10:00:00Z '2026-11-06 10:00:00')"
    "merge|$(sub "$MERGE" 2026-11-06T10:00:00Z 2026-11-06T10:00:00+01:00)"
    "merge|$(sub "$MERGE" 2026-11-06T10:00:00Z 2026-13-06T10:00:00Z)"
    "merge|$(sub "$MERGE" octo-cat 'octo cat')"
    "merge|$(sub "$MERGE" octo-cat "$A40")"
    "merge|$(sub "$MERGE" "$MF" '{"type":"decision"}')"
    "merge|$(sub "$MERGE" "$MF" '{"type":"decision","decisionId":"0000000A-0000-4000-8000-000000000000"}')"
    "merge|$(sub "$MERGE" "$MF" '{"type":"none","by":"x"}')"
    "merge|$(sub "$MERGE" "$MF" '{"type":"chat"}')"
    'merge-unknown|{"pr":"42"}'
    "merge-unknown|{\"pr\":42,\"sha\":\"$H40\"}"
)
bad=""; n=0
for r in "${ROWS[@]}"; do
    n=$((n + 1)); rm -f "$TL"
    append "${r%%|*}" "${r#*|}"
    [[ $RC -ne 0 && "$ERR" == "oss: "* && "$(printf '%s\n' "$ERR" | grep -c .)" -eq 1 && ! -e "$TL" ]] || bad="$bad [$r rc=$RC err=$ERR]"
done
[[ -z "$bad" && $n -ge 40 ]] && pass "should refuse any value outside the API pattern for its field, and write nothing ($n rows)" \
    || fail "should refuse any value outside the API pattern for its field, and write nothing" "rows=$n$bad"
append merge "$(sub "$MERGE" "$MF" '{"type":"decision","decisionId":"0000000a-0000-4000-8000-000000000000"}')"
[[ $RC -eq 0 && $(last "$TL" | jq -r .approval.decisionId) == 0000000a-0000-4000-8000-000000000000 ]] \
    && pass "should accept a decision approval with a lower-case uuid v4" \
    || fail "should accept a decision approval with a lower-case uuid v4" "rc=$RC err=$ERR"

# --- a repo that never used OSS -----------------------------------------------------------------------------------
Q=$(mktemp -d "$T/plain.XXXXXX"); (cd "$Q" && git init -q)
export CLAUDE_PROJECT_DIR="$Q"
append command "$CMD"
[[ $RC -eq 0 && ! -e "$Q/.oss" && -z "$ERR" ]] && pass "should exit 0 and write nothing when the project has no .oss folder" \
    || fail "should exit 0 and write nothing when the project has no .oss folder" "rc=$RC err=$ERR $(ls -A "$Q")"

echo ""
echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
