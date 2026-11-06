#!/bin/bash
# Timeline delivery never stalls or strands a line (G2 Phase B, ship fix round 1, Task 10).
#
# @behavior A push sends the waiting lines of every timeline outbox on the machine, not only the one of the feature
#           the current branch names, so a branch switch or the ship archive (the feature folder moved to
#           .oss/dev/completed/) leaves nothing pending. A reply that is neither stored, refused nor withheld (401,
#           403, 404, 413, 422, 429, an unknown 409, a 2xx naming no account, a timeout or an unreachable API)
#           counts as a retry, the third marks the line failed, and a retrying line never holds back the lines
#           behind it. An outbox drops the lines of every id in a final state, under its lock, so a push never
#           re-reads a whole history. A state that cannot be written stops the run at once.
# @business-rule radical-observability G2 AC-G2-005.6 and the ship gates: no line waits forever, no line is sent
#           twice in a run, a run stays inside its bounds (8 POSTs, ~40 s), and the switch and the team policy
#           (one GET per run) still decide whether anything is sent.
#
# The REAL hooks from this checkout run with a sandbox HOME whose OSS config points at a fake API (a `curl` first
# on PATH: hooks/__tests__/fake-oss-api.sh) and an obviously fake key.
# Usage: /bin/bash hooks/__tests__/timeline-delivery.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
# The fake API stands at a plain-http loopback apiUrl: that needs the opt-in (T20).
export OSS_ALLOW_HTTP_LOOPBACK=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$ROOT/hooks/oss-timeline.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running timeline-delivery tests..."
# shellcheck source=hooks/__tests__/lib/run-capped.sh
source "$ROOT/hooks/__tests__/lib/run-capped.sh"   # the one time cap a test may use (T49)

T=$(cd "$(mktemp -d /tmp/oss-timeline-delivery.XXXXXX)" && pwd -P)
trap 'chmod -R u+w "$T" 2>/dev/null; rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.oss"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR OSS_TL_SESSION CLAUDE_PLUGIN_ROOT
export CLAUDE_CODE_SESSION_ID=td-session-1
# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
API="$T/api-fake"; fake_api_install "$API"
export PATH="$API/bin:$PATH"
printf '{"apiKey":"%s","apiUrl":"http://127.0.0.1:9"}\n' 'fake-oss-key-timeline-delivery-0042' > "$HOME/.oss/config.json"

# a product repo with the demo and other feature folders
P="$T/product"
OB_DIR="$HOME/.oss/timeline-outbox"
ob_of() { echo "$OB_DIR/$(printf '%s' "$P/.oss/dev/active/$1/timeline.ndjson" | shasum -a 256 | cut -c1-16).ndjson"; }
TL="$P/.oss/dev/active/demo/timeline.ndjson"
OB=$(ob_of demo)
RID=$(basename "$OB" .ndjson)

# reset: a fresh repo on feat/demo/build, a fresh fake API, no outbox
reset() {
    chmod -R u+w "$OB_DIR" 2>/dev/null
    rm -rf "$P" "$API/api" "$OB_DIR" "$HOME/.oss/locks"; mkdir -p "$API/api" "$P/.oss/dev/active/demo" "$P/.oss/dev/active/other"
    (cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/build)
}
export CLAUDE_PROJECT_DIR="$P"
# write [n]: n command lines through the real writer, on the current branch
write() { local i; for ((i = 0; i < ${1:-1}; i++)); do (cd "$P" && run_capped 20 "$HOOK" command build start </dev/null >/dev/null 2>&1); done; }
# push: one push run, as the detached start runs it -> RC, $T/err
push() { (cd "$P" && run_capped 120 "$HOOK" push </dev/null >/dev/null 2>"$T/err"); RC=$?; }
queue() { printf '%s\n' "$2" >> "$API/api/queue.$1"; }
posts() { local c; c=$(grep -c '^timeline ' "$API/api/calls" 2>/dev/null); echo "${c:-0}"; }
policies() { local c; c=$(grep -c '^policy ' "$API/api/calls" 2>/dev/null); echo "${c:-0}"; }
ids_of() { jq -r '.id' "$1" 2>/dev/null | tr '\n' ' '; }
posted_ids() { jq -r '.id' "$API/api/bodies" 2>/dev/null | tr '\n' ' '; }
state_of() { jq -Rr --arg id "$1" 'fromjson? | select(.id == $id) | .state' "$OB" 2>/dev/null | tail -n 1; }
states() { local i s=""; for i in $(ids_of "$TL"); do s="$s$(state_of "$i") "; done; echo "$s"; }
# final ID STATE: the outbox records STATE for ID, as a push would
final() { jq -nc --arg id "$1" --arg s "$2" '{id: $id, state: $s}' >> "$OB"; }

# --- every outbox, not only the current feature's ------------------------------------------------------------------
name='should send waiting lines of every outbox, not only the current feature'"'"'s'
reset; write 1; demo=$(ids_of "$TL")
(cd "$P" && git checkout -q -b feat/other/build); write 1; other=$(ids_of "$P/.oss/dev/active/other/timeline.ndjson")
queue policy '000 unreachable'; push   # both lines wait
push
[[ $RC -eq 0 && "$(posts)" == 2 && " $(posted_ids)" == *" ${demo%% }"* && " $(posted_ids)" == *" ${other%% }"* && "$(policies)" == 2 ]] \
    && pass "$name (after a branch switch, one policy GET per run)" \
    || fail "$name (after a branch switch, one policy GET per run)" "rc=$RC posts=$(posts) posted=$(posted_ids) demo=$demo other=$other policies=$(policies)"

reset; write 2; want=$(ids_of "$TL")
mkdir -p "$P/.oss/dev/completed"; mv "$P/.oss/dev/active/demo" "$P/.oss/dev/completed/demo"   # the ship archive
push
[[ $RC -eq 0 && "$(posts)" == 2 && "$(posted_ids)" == "$want" ]] && pass "$name (after the ship archive moved the feature folder)" \
    || fail "$name (after the ship archive moved the feature folder)" "rc=$RC posts=$(posts) posted=$(posted_ids) want=$want"

reset; write 1; printf 'off\n' > "$HOME/.oss/decisions-push-off"
(cd "$P" && git checkout -q -b feat/other/build); push
[[ $RC -eq 0 && ! -s "$API/api/calls" ]] && pass "$name (the push switch still sends nothing)" \
    || fail "$name (the push switch still sends nothing)" "calls=$(cat "$API/api/calls" 2>/dev/null)"
rm -f "$HOME/.oss/decisions-push-off"

# --- a reply that is not final is a retry, toward the 5xx cap --------------------------------------------------------
name='should count the reply as a retry'
for r in '401 {"error":"unauthorized"}' '403 {"error":"forbidden"}' '404 {"error":"not_found"}' '413 {"error":"too_large"}' \
    '422 {"error":"unprocessable"}' '429 {"error":"rate_limited"}' '409 {"error":"something_new"}' '201 {}' \
    '200 {"account":{"email":"dev@example.invalid"}}' '000 unreachable'; do
    reset; write 1; queue timeline "$r"; push
    id=$(ids_of "$TL" | tr -d ' ')
    [[ $RC -eq 0 && "$(state_of "$id")" == retry ]] && pass "$name (${r%% *} ${r#* })" \
        || fail "$name (${r%% *} ${r#* })" "rc=$RC state=$(state_of "$id")"
done

name='should mark the line failed after the retry cap, one POST per line per run'
reset; write 1; queue timeline '429 {"error":"rate_limited"}'; queue timeline '429 {"error":"rate_limited"}'; queue timeline '000 unreachable'
push; s1="$(states)/$(posts)"; push; s2="$(states)/$(posts)"; push; s3="$(states)/$(posts)"
[[ "$s1" == "retry /1" && "$s2" == "retry /2" && "$s3" == "failed /3" ]] && pass "$name" || fail "$name" "runs: $s1 $s2 $s3"

name='should not let one retrying line block the lines behind it'
reset; write 3; queue timeline '401 {"error":"unauthorized"}'; push
[[ $RC -eq 0 && "$(posts)" == 3 && "$(states)" == "retry verified verified " ]] && pass "$name" \
    || fail "$name" "rc=$RC posts=$(posts) states=$(states)"
reset; write 3; queue timeline '503 {"error":"down"}'; push
[[ $RC -eq 0 && "$(posts)" == 3 && "$(states)" == "retry verified verified " ]] && pass "$name (a 5xx too)" \
    || fail "$name (a 5xx too)" "rc=$RC posts=$(posts) states=$(states)"

# --- compaction --------------------------------------------------------------------------------------------------------
name='should compact an outbox once it holds only lines in a final state (verified, refused, withheld, conflict, failed), under its lock'
reset; write 5; set -- verified refused withheld conflict failed
for i in $(ids_of "$TL"); do final "$i" "$1"; shift; done
ino=$(ls -i "$OB" | awk '{print $1}')
push
[[ $RC -eq 0 && -f "$OB" && ! -L "$OB" && ! -s "$OB" && "$(ls -i "$OB" | awk '{print $1}')" == "$ino" && ! -s "$API/api/calls" ]] \
    && pass "$name (emptied, no call made)" \
    || fail "$name (emptied, no call made)" "rc=$RC size=$(wc -c < "$OB" 2>/dev/null) calls=$(cat "$API/api/calls" 2>/dev/null)"

reset; write 3; read -r -a l <<< "$(ids_of "$TL")"; set -- "${l[@]}"; final "$1" verified
queue policy '000 unreachable'; push
left=$(jq -r '.id' "$OB" 2>/dev/null | sort -u | tr '\n' ' ')
want=$(printf '%s\n' "$2" "$3" | sort | tr '\n' ' ')
[[ $RC -eq 0 && "$left" == "$want" && "$(jq -sc 'map(.state)' "$OB")" == '["pending","pending"]' ]] && pass "$name (only the waiting ids stay)" \
    || fail "$name (only the waiting ids stay)" "left=$left want=$want outbox=$(cat "$OB")"

reset; write 2; for i in $(ids_of "$TL"); do final "$i" verified; done
before=$(cat "$OB"); mkdir -p "$HOME/.oss/locks/$RID"; push
[[ $RC -eq 0 && "$(cat "$OB")" == "$before" ]] && pass "$name (not while a writer holds its lock)" \
    || fail "$name (not while a writer holds its lock)" "rc=$RC outbox=$(cat "$OB")"
rmdir "$HOME/.oss/locks/$RID"

# --- a mark that cannot be written ---------------------------------------------------------------------------------
name='should stop the run when a state mark cannot be written'
reset; write 3; chmod 400 "$OB"; start=$SECONDS; push; took=$((SECONDS - start))
[[ $RC -eq 0 && "$(posts)" == 1 && $took -lt 20 ]] && pass "$name (one POST, no spin)" \
    || fail "$name (one POST, no spin)" "rc=$RC posts=$(posts) took=${took}s"
chmod 600 "$OB"

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
