#!/bin/bash
# Nothing unsafe or unbounded is written to or read for the feature timeline (radical-observability G2, Task 12).
#
# @behavior A timeline line that holds what the API reads as a bare key (a run of 32 or more letters and digits
#           with a digit, in session, feature, agent, gate, command or mergedBy) is refused before the committed
#           timeline.ndjson is written. The hook reads workflow-state.json only when it is a single-link regular
#           file of at most 64 KB, and its stdin only up to 1 MB. A timeline.ndjson the person does not own is
#           never appended to. A session with no repo (the project resolves to $HOME) writes and queues nothing.
#           A feature folder name over 128 characters files the line as unfiled, and timeline-unfiled.ndjson
#           stops growing at 1 MB. The push reads an outbox id only when the whole id is one (\A..\z). The merge
#           verb reads the feature's decisions.ndjson only up to 1 MB, and a refused approval still leaves a
#           local merge-unknown line (a real merge always leaves a trace), never queued for the API.
# @business-rule The API's holdsBareSecret (AgenticDevWorkflow packages/api/src/routes/timeline.ts, 400 "Holds a
#           secret"), AC-G2-001.3 and 001.5 (closed patterns, no write through a link or into another's file),
#           P-2 (merge-unknown is local only), P-3 (unfiled is never pushed), P-14 (what a merge line trusts).
# Usage: /bin/bash hooks/__tests__/timeline-bounds.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TLS="$ROOT/hooks/oss-timeline.sh"
OV="$ROOT/hooks/oss-value.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running timeline-bounds tests..."

T=$(cd "$(mktemp -d /tmp/oss-timeline-bounds.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.oss"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_PROJECT_DIR OSS_TL_SESSION CLAUDE_PLUGIN_ROOT
export CLAUDE_CODE_SESSION_ID=bounds-sess-1

# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
source "$ROOT/hooks/__tests__/lib/run-capped.sh"   # the one time cap a test may use (T49)
API="$T/api-fake"; fake_api_install "$API"   # no config.json until the last section: any curl reaches only the fake

# The fake gh (timeline-merge.test.sh's): answers `pr view` with a merged PR
mkdir -p "$T/gh/bin"
SHA=0123456789abcdef0123456789abcdef01234567
cat > "$T/gh/bin/gh" << GH
#!/bin/bash
[[ "\$1 \$2" == "pr view" ]] || exit 1
printf '%s\n' '{"number":4242,"mergeCommit":{"oid":"$SHA"},"mergedAt":"2026-11-06T09:30:00Z","mergedBy":{"login":"octo-dev"}}'
GH
chmod +x "$T/gh/bin/gh"
export PATH="$T/gh/bin:$API/bin:$PATH"

# new_project <branch> [active folder...] -> P, a product repo on <branch>; TL its demo timeline, UN the unfiled one
new_project() {
    local b="$1" f; shift
    P=$(mktemp -d "$T/p.XXXXXX"); mkdir -p "$P/.oss/dev/active"
    for f in "$@"; do mkdir -p "$P/.oss/dev/active/$f"; done
    (cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -B "$b")
    export CLAUDE_PROJECT_DIR="$P"
    TL="$P/.oss/dev/active/demo/timeline.ndjson"; UN="$P/.oss/dev/timeline-unfiled.ndjson"
}
# append <kind> <fields json> -> RC, ERR: the writer, sourced in a subshell, as a verb calls it
append() {
    run_capped 30 /bin/bash -c 'source "$1" || exit 99; oss_timeline_append "$2" "$3"' _ "$TLS" "$1" "$2" 2>"$T/err"
    RC=$?; ERR=$(cat "$T/err")
}
# hook <stdin file>: the PostToolUse hook as Claude Code runs it -> RC
hook() { (cd "$P" && run_capped 30 "$TLS" < "$1" > /dev/null 2>"$T/err"); RC=$?; ERR=$(cat "$T/err"); }
lines() { local c=0; [[ -f "$1" ]] && c=$(wc -l < "$1" | tr -d ' '); echo "$c"; }
last() { tail -n 1 "$1" 2>/dev/null; }
size() { local c=0; [[ -f "$1" ]] && c=$(wc -c < "$1" | tr -d ' '); echo "$c"; }
# pad <bytes>: that many x characters
pad() { head -c "$1" /dev/zero | tr '\0' x; }
outbox() { cat "$HOME"/.oss/timeline-outbox/*.ndjson 2>/dev/null; }

# 32 letters and digits with a digit: the API's bare-key run; and two near misses the API accepts
SECRET=abcdefghijklmnopqrstuvwxyz012345
LETTERS=abcdefghijklmnopqrstuvwxyzabcdef   # 32 letters, no digit
SHORT=abcdefghijklmnopqrstuvwxyz01234      # 31
GATE_OF() { printf '{"round":1,"gate":"%s","verdict":"pass","findings":{},"fixed":{},"mode":"full"}' "$1"; }
MERGE_OF() { printf '{"pr":42,"sha":"%s","mergedAt":"2026-11-06T10:00:00Z","mergedBy":"%s","approval":{"type":"merge-flag"}}' "$SHA" "$1"; }

# --- the API's bare-secret run is refused before the committed file is written ------------------------------------
name="should refuse a line holding the API's bare-secret run (32+ letters and digits with a digit, in session, repo, feature, agent, gate, command, mergedBy), before the committed file is written"
ok=1 bad=""
new_project feat/demo/build demo
for c in "command|{\"command\":\"x$SECRET\",\"status\":\"start\"}" "agent|{\"agent\":\"oss:$SECRET\"}" \
    "gate|$(GATE_OF "$SECRET")" "gate|$(GATE_OF "gate-$SECRET")" "merge|$(MERGE_OF "$SECRET")"; do
    before=$(lines "$TL"); append "${c%%|*}" "${c#*|}"
    [[ $RC -ne 0 && $(lines "$TL") -eq $before ]] || { ok=0; bad="$bad ${c%%|*}:rc=$RC line=$(last "$TL")"; }
done
before=$(lines "$TL")
OSS_TL_SESSION=$SECRET append command '{"command":"build","status":"start"}'
[[ $RC -ne 0 && $(lines "$TL") -eq $before ]] || { ok=0; bad="$bad session:rc=$RC line=$(last "$TL")"; }
new_project "feat/$SECRET/build" "$SECRET"
append command '{"command":"build","status":"start"}'
[[ $RC -ne 0 && ! -e "$P/.oss/dev/active/$SECRET/timeline.ndjson" && ! -e "$UN" ]] || { ok=0; bad="$bad feature:rc=$RC"; }
# the near misses still pass: no digit, 31 characters, or runs split by a dash
new_project feat/demo/build demo
for g in "$LETTERS" "$SHORT" "abcdefghijklmnop-qrstuvwxyz012345"; do
    before=$(lines "$TL"); append gate "$(GATE_OF "$g")"
    [[ $RC -eq 0 && $(lines "$TL") -eq $((before + 1)) ]] || { ok=0; bad="$bad near-miss=$g:rc=$RC err=$ERR"; }
done
[[ $ok -eq 1 ]] && pass "$name" || fail "$name" "$bad (err=$ERR)"

# --- workflow-state.json and the hook's stdin are read within bounds ----------------------------------------------
name='should read workflow-state.json only when it is a single-link regular file of at most 64 KB'
ok=1 bad=""
new_project feat/demo/build demo
printf '%s\n' '{"tool_name":"Agent","tool_input":{"subagent_type":"oss:code-reviewer"}}' > "$T/in.json"
WS="$P/.oss/workflow-state.json"
printf '{"currentCommand":"build"}\n' > "$WS"
hook "$T/in.json"; [[ "$(last "$TL" | jq -r '.command // "none"')" == build ]] || { ok=0; bad="$bad small:$(last "$TL")"; }
ln "$WS" "$T/ws-second-link"
hook "$T/in.json"; [[ "$(last "$TL" | jq -r '.command // "none"')" == none ]] || { ok=0; bad="$bad hard-linked:$(last "$TL")"; }
rm -f "$T/ws-second-link" "$WS"
printf '{"currentCommand":"build","pad":"%s"}\n' "$(pad 65536)" > "$WS"
hook "$T/in.json"; [[ "$(last "$TL" | jq -r '.command // "none"')" == none ]] || { ok=0; bad="$bad over-64KB:$(last "$TL")"; }
printf '{"currentCommand":"build","pad":"%s"}\n' "$(pad 60000)" > "$WS"
hook "$T/in.json"; [[ "$(last "$TL" | jq -r '.command // "none"')" == build ]] || { ok=0; bad="$bad under-64KB:$(last "$TL")"; }
rm -f "$WS"
[[ $ok -eq 1 ]] && pass "$name" || fail "$name" "$bad"

name="should read the hook's stdin only up to 1 MB"
ok=1
printf '{"tool_name":"Agent","tool_input":{"subagent_type":"oss:code-reviewer"},"pad":"%s"}\n' "$(pad 900000)" > "$T/in-900k.json"
printf '{"tool_name":"Agent","tool_input":{"subagent_type":"oss:code-reviewer"},"pad":"%s"}\n' "$(pad 1100000)" > "$T/in-1.1m.json"
before=$(lines "$TL"); hook "$T/in-900k.json"; under=$(($(lines "$TL") - before))
before=$(lines "$TL"); hook "$T/in-1.1m.json"; over=$(($(lines "$TL") - before))
[[ $under -eq 1 && $over -eq 0 && $RC -eq 0 ]] && pass "$name" || fail "$name" "under-1MB lines=$under over-1MB lines=$over rc=$RC"

# --- a timeline.ndjson the person does not own --------------------------------------------------------------------
name='should refuse a timeline.ndjson the person does not own'
new_project feat/demo/build demo
append command '{"command":"build","status":"start"}'
before=$(lines "$TL")
# someone else's file, through `test -O` (the repo's other-user seam)
OSS_T_FOREIGN="$TL" run_capped 30 /bin/bash -c 'test() { if [[ "${1:-}" == -O && "${2:-}" == "$OSS_T_FOREIGN" ]]; then return 1; fi; builtin test "$@"; }
    source "$1" || exit 99; oss_timeline_append command "{\"command\":\"build\",\"status\":\"complete\"}"' _ "$TLS" 2>"$T/err"
RC=$?
[[ $before -eq 1 && $RC -ne 0 && $(lines "$TL") -eq $before ]] && pass "$name" || fail "$name" "rc=$RC before=$before after=$(lines "$TL") err=$(cat "$T/err")"

# --- no repo: the project resolves to $HOME ----------------------------------------------------------------------
name='should write nothing when the project resolves to $HOME'
unset CLAUDE_PROJECT_DIR
rm -rf "$HOME/.oss/timeline-outbox"
N="$HOME/nowhere"; mkdir -p "$N"
DH=$(cd "$N" && "$OV" dir 2>/dev/null)
ok=1 bad=""
[[ -d "$DH" ]] || { ok=0; bad="$bad no-home-value-folder"; }
for v in round:1 gate:code-review verdict:pass findings: fixed: mode:full; do printf '%s\n' "${v#*:}" > "$DH/${v%%:*}.txt"; done
(cd "$N" && run_capped 30 "$OV" timeline gate > /dev/null 2>&1)
printf 'merge-flag\n' > "$DH/approval.txt"
(cd "$N" && run_capped 30 "$OV" timeline merge > /dev/null 2>&1)
(cd "$N" && CLAUDE_PROJECT_DIR="$HOME" run_capped 30 "$TLS" command build start > /dev/null 2>&1)
left=$(find "$HOME/.oss/dev" -type f 2>/dev/null)
[[ $ok -eq 1 && -z "$left" && -z "$(outbox)" ]] && pass "$name" || fail "$name" "$bad written=[$left] outbox=[$(outbox)]"

# --- feature names over 128 characters, and the unfiled file's 1 MB bound ----------------------------------------
name='should file a line for a feature folder name over 128 characters as unfiled'
LONG=$(printf 'f%.0s' {1..129})
new_project "feat/$LONG/build" "$LONG"
append command '{"command":"build","status":"start"}'
[[ $RC -eq 0 && $(lines "$UN") -eq 1 && "$(last "$UN" | jq -r 'has("feature")')" == false \
    && ! -e "$P/.oss/dev/active/$LONG/timeline.ndjson" ]] && pass "$name" || fail "$name" "rc=$RC unfiled=$(last "$UN") err=$ERR"

name='should stop appending to timeline-unfiled.ndjson once it reaches 1 MB'
new_project main
mkdir -p "$P/.oss/dev"
{ pad 1048575; printf '\n'; } > "$UN"   # exactly 1 MB
before=$(size "$UN"); append command '{"command":"build","status":"start"}'; at=$(size "$UN")
{ pad 1048574; printf '\n'; } > "$UN"   # one byte short
before2=$(size "$UN"); append command '{"command":"build","status":"start"}'; below=$(size "$UN")
[[ $at -eq $before && $below -gt $before2 ]] && pass "$name" || fail "$name" "at-1MB grew $before->$at, below-1MB $before2->$below err=$ERR"

# --- the merge verb: decisions.ndjson bound, and a refused approval still leaves a trace -------------------------
new_project feat/demo/build demo
D=$(cd "$P" && "$OV" dir 2>/dev/null)
UUID=3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d
DREC="$P/.oss/dev/active/demo/decisions.ndjson"
approve() { printf '%s\n' "$1" > "$D/approval.txt"; }
merge() { (cd "$P" && run_capped 40 "$OV" timeline merge > /dev/null 2> "$T/err"); RC=$?; ERR=$(cat "$T/err"); }
ago() {
    local t=$(($(date +%s) - $1)) s
    s=$(date -r "$t" +%Y%m%d%H%M.%S 2>/dev/null || date -d "@$t" +%Y%m%d%H%M.%S) && touch -t "$s" "$2"
}

name="should read the feature's decisions.ndjson only up to 1 MB for the decision-id check"
ok=1 bad=""
printf '%s\n' '{"v":1,"id":"'$UUID'","feature":"demo"}' > "$DREC"
approve "decision:$UUID"; merge
[[ $RC -eq 0 && "$(last "$TL" | jq -r .kind)" == merge ]] || { ok=0; bad="$bad first-line: rc=$RC line=$(last "$TL")"; }
{ printf '{"v":1,"pad":"%s"}\n' "$(pad 1048576)"; printf '%s\n' '{"v":1,"id":"'$UUID'","feature":"demo"}'; } > "$DREC"
approve "decision:$UUID"; merge
[[ $RC -ne 0 && "$(last "$TL" | jq -r .kind)" == merge-unknown ]] || { ok=0; bad="$bad past-1MB: rc=$RC line=$(last "$TL")"; }
printf '%s\n' '{"v":1,"id":"'$UUID'","feature":"demo"}' > "$DREC"
[[ $ok -eq 1 ]] && pass "$name" || fail "$name" "$bad (err=$ERR)"

name='should still write a local merge-unknown line when the approval is refused (a decision id not in the record, or a stale or malformed approval.txt), and queue nothing for the API'
ok=1 bad=""
ob_before=$(outbox | wc -l | tr -d ' ')
# refused <case>: rc != 0, one new merge-unknown line with the pr, approval.txt gone
refused() {
    [[ $RC -ne 0 && $(lines "$TL") -eq $((before + 1)) && "$(last "$TL" | jq -c '[.kind, .pr]')" == '["merge-unknown",4242]' && ! -e "$D/approval.txt" ]] \
        || { ok=0; bad="$bad $1: rc=$RC line=$(last "$TL")"; }
}
before=$(lines "$TL"); approve "decision:7a1c2e3f-4b5d-4e6f-9a0b-1c2d3e4f5a6b"; merge; refused not-in-record
before=$(lines "$TL"); approve chat-instruction; ago 660 "$D/approval.txt"; merge; refused stale
before=$(lines "$TL"); approve approved; merge; refused malformed
ob_after=$(outbox | wc -l | tr -d ' ')
[[ $ob_after -eq $ob_before && -z "$(outbox | grep merge-unknown)" ]] || { ok=0; bad="$bad queued=$((ob_after - ob_before))"; }
[[ $ok -eq 1 ]] && pass "$name" || fail "$name" "$bad (err=$ERR)"

# --- the push reads an outbox id only when the whole id is one ---------------------------------------------------
name='should send no outbox entry whose id is a valid id followed by a newline (\A..\z, not ^..$)'
export OSS_ALLOW_HTTP_LOOPBACK=1   # the fake API stands at a plain-http loopback apiUrl (T20)
printf '{"apiKey":"fake-oss-key-timeline-bounds-0042","apiUrl":"http://127.0.0.1:9"}\n' > "$HOME/.oss/config.json"
rm -rf "$HOME/.oss/timeline-outbox" "$API/api"; mkdir -p "$API/api" "$HOME/.oss/timeline-outbox"; chmod 700 "$HOME/.oss/timeline-outbox"
OBF="$HOME/.oss/timeline-outbox/0123456789abcdef.ndjson"
(umask 077; jq -nc --arg id "$UUID"$'\n' '{id: $id, state: "pending", fp: "0123456789abcdef", body: {v: 1, id: $id}}' > "$OBF")
(cd "$P" && run_capped 60 "$TLS" push < /dev/null > /dev/null 2>&1)
posts=$(grep -c '^timeline ' "$API/api/calls" 2>/dev/null)
[[ "${posts:-0}" -eq 0 ]] && pass "$name" || fail "$name" "posts=$posts bodies=$(cat "$API/api/bodies" 2>/dev/null)"
rm -f "$HOME/.oss/config.json"

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
