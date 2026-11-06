#!/bin/bash
# A feature's timeline lines go to the person's OSS account from a private outbox on their own machine (G2, B5).
#
# @behavior Each line written to a feature's timeline is also queued, as pending, in a private outbox under
#           ~/.oss (outside the repo, owner-only). The push asks the team policy first, then sends each waiting
#           line to POST /api/v1/timeline with the fingerprint of the key it was written under, the key itself on
#           curl's stdin only. Every reply is written back to the outbox: stored, refused (said once, by line id),
#           withheld, conflict, retry and finally failed. Unfiled and merge-unknown lines are never queued. The
#           person's off switch, a team that opted out, a busy push and an outbox that is not the person's own
#           single file all mean nothing is sent.
# @business-rule radical-observability G2 AC-G2-005.2 and 005.6, P-2, P-3, P-7: the push is refused the same
#           way as a decision push (one switch, one team policy, G1's reply table); a run is bounded (8 POSTs,
#           no POST started after ~40 s); nothing is retried forever; a line counts as stored only when the API
#           names the account.
#
# The REAL hooks from this checkout run with a sandbox HOME whose OSS config points at a fake API (a `curl` first
# on PATH: hooks/__tests__/fake-oss-api.sh) and an obviously fake key.
# Usage: /bin/bash hooks/__tests__/timeline-push.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
# The fake API stands at a plain-http loopback apiUrl: that needs the opt-in (T20).
export OSS_ALLOW_HTTP_LOOPBACK=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$ROOT/hooks/oss-timeline.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running timeline-push tests..."
# shellcheck source=hooks/__tests__/lib/run-capped.sh
source "$ROOT/hooks/__tests__/lib/run-capped.sh"   # the one time cap a test may use (T49)

T=$(cd "$(mktemp -d /tmp/oss-timeline-push.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.oss"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR OSS_TL_SESSION CLAUDE_PLUGIN_ROOT
export CLAUDE_CODE_SESSION_ID=tp-session-1
# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
API="$T/api-fake"; fake_api_install "$API"
export PATH="$API/bin:$PATH"
FAKE_KEY='fake-oss-key-timeline-push-0042'
printf '{"apiKey":"%s","apiUrl":"http://127.0.0.1:9"}\n' "$FAKE_KEY" > "$HOME/.oss/config.json"
FP=$(printf '%s' "$FAKE_KEY" | shasum -a 256 | cut -c1-16)

# a product repo on feat/demo/build with the demo feature folder
P="$T/product"; mkdir -p "$P/.oss/dev/active/demo"
(cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/build)
export CLAUDE_PROJECT_DIR="$P"
TL="$P/.oss/dev/active/demo/timeline.ndjson"
# the outbox of this timeline: ~/.oss/timeline-outbox/<16 hex of the file's physical path>.ndjson
OB_DIR="$HOME/.oss/timeline-outbox"
OB="$OB_DIR/$(printf '%s' "$TL" | shasum -a 256 | cut -c1-16).ndjson"

mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
# reset: a fresh fake API, no timeline, no outbox, no switch
reset() { rm -rf "$API/api" "$OB_DIR" "$TL" "$HOME/.oss/decisions-push-off" "$HOME/.oss/settings.json"; mkdir -p "$API/api"; }
# write [n]: n command lines through the real writer (the command verb starts no push: oss-notify does)
write() { local i; for ((i = 0; i < ${1:-1}; i++)); do (cd "$P" && run_capped 20 "$HOOK" command build start </dev/null >/dev/null 2>&1); done; }
# push: one push run, as the detached start runs it -> RC, $T/err
push() { (cd "$P" && run_capped 120 "$HOOK" push </dev/null >/dev/null 2>"$T/err"); RC=$?; }
queue() { printf '%s\n' "$2" >> "$API/api/queue.$1"; }
posts() { local c; c=$(grep -c '^timeline ' "$API/api/calls" 2>/dev/null); echo "${c:-0}"; }
calls() { local c=0; [[ -f "$API/api/calls" ]] && c=$(wc -l < "$API/api/calls" | tr -d ' '); echo "$c"; }
ids() { jq -r '.id' "$TL" 2>/dev/null | tr '\n' ' '; }
posted_ids() { jq -r '.id' "$API/api/bodies" 2>/dev/null | tr '\n' ' '; }
state_of() { jq -Rr --arg id "$1" 'fromjson? | select(.id == $id) | .state' "$OB" 2>/dev/null | tail -n 1; }
states() { local i s=""; for i in $(ids); do s="$s$(state_of "$i") "; done; echo "$s"; }

# --- the outbox ---------------------------------------------------------------------------------------------------
name='should queue each new feature line as pending in ~/.oss/timeline-outbox/<rid>.ndjson (folder 700, file 600)'
reset; write 2
want=$(jq -sc --arg fp "$FP" 'map({id, state: "pending", fp: $fp, body: .})' "$TL")
got=$(jq -sc . "$OB" 2>/dev/null)
[[ -n "$got" && "$got" == "$want" && "$(mode_of "$OB_DIR")" == 700 && "$(mode_of "$OB")" == 600 && "$(calls)" == 0 ]] && pass "$name" \
    || fail "$name" "got=$got want=$want modes=$(mode_of "$OB_DIR" 2>/dev/null)/$(mode_of "$OB" 2>/dev/null) calls=$(calls)"

name='should never queue an unfiled line or a merge-unknown line'
reset; U="$T/unfiled"; mkdir -p "$U/.oss"
(cd "$U" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init)
(cd "$U" && CLAUDE_PROJECT_DIR="$U" run_capped 20 "$HOOK" command build start </dev/null >/dev/null 2>&1)
(cd "$P" && run_capped 20 /bin/bash -c 'source "$1" && oss_timeline_append merge-unknown "{\"pr\":7}"' _ "$HOOK" </dev/null >/dev/null 2>&1)
unk=$(jq -r 'select(.kind == "merge-unknown") | .id' "$TL" 2>/dev/null)
[[ -s "$U/.oss/dev/timeline-unfiled.ndjson" && -n "$unk" && -z "$(cat "$OB_DIR"/*.ndjson 2>/dev/null)" ]] && pass "$name" \
    || fail "$name" "unfiled=$(cat "$U/.oss/dev/timeline-unfiled.ndjson" 2>/dev/null) merge-unknown=$unk outbox=$(cat "$OB_DIR"/*.ndjson 2>/dev/null)"

# --- the switch and the team policy --------------------------------------------------------------------------------
name='should send nothing when the local push switch is off'
for how in marker settings; do
    reset
    if [[ $how == marker ]]; then printf 'off\n' > "$HOME/.oss/decisions-push-off"; else printf '{"decisionsPush":false}\n' > "$HOME/.oss/settings.json"; fi
    write 1; push
    [[ $RC -eq 0 && "$(calls)" == 0 && -z "$(cat "$OB" 2>/dev/null)" ]] && pass "$name ($how)" \
        || fail "$name ($how)" "rc=$RC calls=$(calls) outbox=$(cat "$OB" 2>/dev/null)"
done

name='should GET /api/v1/decisions/policy first and withhold every waiting line when pushEnabled is false'
reset; write 2; queue policy '200 {"pushEnabled":false,"team":true}'; push
first=$(head -n 1 "$API/api/calls" 2>/dev/null)
[[ $RC -eq 0 && "$first" == "policy http://127.0.0.1:9/api/v1/decisions/policy" && "$(posts)" == 0 && "$(states)" == "withheld withheld " ]] && pass "$name" \
    || fail "$name" "rc=$RC first=$first posts=$(posts) states=$(states)"

# --- the POST -------------------------------------------------------------------------------------------------------
name='should POST each waiting line to /api/v1/timeline with keyFp, the key on stdin and --max-time 5'
reset; write 2; push
n=$(grep -n '^timeline ' "$API/api/calls" 2>/dev/null | head -n 1 | cut -d: -f1)
want=$(jq -sc --arg fp "$FP" 'map(.keyFp = $fp)' "$TL")
got=$(jq -sc . "$API/api/bodies" 2>/dev/null)
leak=$(cat "$API"/api/argv.* 2>/dev/null | grep -c "$FAKE_KEY")
[[ $RC -eq 0 && "$(posts)" == 2 && "$got" == "$want" && "$leak" == 0 && -n "$n" ]] \
    && grep -q -- '--max-time 5' "$API/api/argv.$n" && grep -q "Bearer $FAKE_KEY" "$API/api/config.$n" \
    && [[ "$(sed -n "${n}p" "$API/api/calls")" == "timeline http://127.0.0.1:9/api/v1/timeline" && "$(states)" == "verified verified " ]] && pass "$name" \
    || fail "$name" "rc=$RC posts=$(posts) got=$got want=$want leak=$leak argv=$(cat "$API/api/argv.$n" 2>/dev/null) states=$(states)"

# --- the replies ----------------------------------------------------------------------------------------------------
name='should handle each reply'
# reply <case> <status body> <want state>: one line, one reply
reply() {
    reset; write 1; queue timeline "$2"; push
    local id; id=$(ids | tr -d ' ')
    [[ $RC -eq 0 && "$(state_of "$id")" == "$3" ]] && pass "$name ($1 -> $3)" || fail "$name ($1 -> $3)" "rc=$RC state=$(state_of "$id") err=$(cat "$T/err")"
}
reply 200 '200 {"account":{"id":"acct-fake-1","email":"dev@example.invalid"}}' verified
reply 201 '201 {"account":{"id":"acct-fake-1","email":"dev@example.invalid"}}' verified
reply 409-conflict '409 {"error":"conflict"}' conflict
reply 409-answered_while_off '409 {"error":"answered_while_off"}' withheld
reply 409-account_mismatch '409 {"error":"account_mismatch"}' withheld

reset; write 1; queue timeline '400 {"error":"Invalid request data","details":[{"path":["agent"],"message":"Holds a secret","code":"custom"}]}'; push
id=$(ids | tr -d ' '); err=$(cat "$T/err"); before=$(posts); push
[[ $RC -eq 0 && "$(state_of "$id")" == refused && $(grep -c . <<< "$err") == 1 && "$err" == *"$id"* && "$(posts)" == "$before" ]] \
    && pass "$name (400 -> refused, never retried, one stderr line naming the line id)" \
    || fail "$name (400 -> refused, never retried, one stderr line naming the line id)" "state=$(state_of "$id") err=$err posts $before -> $(posts)"

reset; write 3; queue timeline '409 {"error":"policy_off"}'; push
[[ $RC -eq 0 && "$(posts)" == 1 && "$(states)" == "withheld withheld withheld " ]] && pass "$name (409 policy_off -> everything waiting withheld, then stop)" \
    || fail "$name (409 policy_off -> everything waiting withheld, then stop)" "posts=$(posts) states=$(states)"

reset; write 2; queue timeline '409 {"error":"account_mismatch"}'; push
[[ $RC -eq 0 && "$(posts)" == 2 && "$(states)" == "withheld verified " ]] && pass "$name (409 account_mismatch withholds that line only and goes on)" \
    || fail "$name (409 account_mismatch withholds that line only and goes on)" "posts=$(posts) states=$(states)"

reset; write 2; queue timeline '503 {"error":"down"}'; push; s1=$(states); p1=$(posts)
queue timeline '500 {"error":"down"}'; push; s2=$(states)
queue timeline '502 {"error":"down"}'; push; s3=$(states)
[[ "$p1" == 1 && "$s1" == "retry pending " && "$s2" == "retry pending " && "$s3" == "failed pending " ]] \
    && pass "$name (5xx -> retry, the third 5xx marks it failed)" \
    || fail "$name (5xx -> retry, the third 5xx marks it failed)" "posts-first-run=$p1 states: $s1 / $s2 / $s3"

name='should retry the waiting lines on the next push after the API was down'
reset; write 2; queue policy '000 unreachable'; push; s1=$(states); c1=$(posts)
push
[[ "$s1" == "pending pending " && "$c1" == 0 && "$(states)" == "verified verified " && "$(posted_ids)" == "$(ids)" ]] && pass "$name" \
    || fail "$name" "first=$s1 posts=$c1 then=$(states) sent=$(posted_ids) ids=$(ids)"

# --- the bounds -----------------------------------------------------------------------------------------------------
name='should send at most 8 POSTs per run and start none after 40 s'
reset; write 12; push
want=$(ids | cut -d' ' -f1-8)
[[ $RC -eq 0 && "$(posts)" == 8 && "$(posted_ids)" == "$want " ]] && pass "$name (8 per run, the oldest first)" \
    || fail "$name (8 per run, the oldest first)" "rc=$RC posts=$(posts)"
# each POST takes 14 s: the third ends past 40 s, so no fourth starts (this check takes about 45 s)
reset; write 5
start=$SECONDS
(cd "$P" && FAKE_DELAY_TIMELINE=14 run_capped 120 "$HOOK" push </dev/null >/dev/null 2>"$T/err"); RC=$?
[[ $RC -eq 0 && "$(posts)" == 3 ]] && pass "$name (none started after 40 s)" \
    || fail "$name (none started after 40 s)" "rc=$RC posts=$(posts) took=$((SECONDS - start))s"

# --- the push lock ---------------------------------------------------------------------------------------------------
name='should hold one push lock per outbox, and leave the lines pending when the lock is busy'
reset; write 2; mkdir "$OB.push"; push
busy="$(calls) $(states)"; rmdir "$OB.push"
push
[[ "$busy" == "0 pending pending " && "$(states)" == "verified verified " && ! -e "$OB.push" ]] && pass "$name" \
    || fail "$name" "while-busy=$busy after=$(states) lock=$(ls -ld "$OB.push" 2>&1)"

# --- the outbox is the person's own single file --------------------------------------------------------------------
name='should refuse an outbox that is a symlink, has a second hard link or belongs to someone else'
for what in symlink hardlink foreign; do
    reset; write 1; O=$(mktemp -d "$T/outside.XXXXXX")
    case $what in
        symlink) mv "$OB" "$O/ob"; ln -s "$O/ob" "$OB" ;;
        hardlink) mv "$OB" "$O/ob"; ln "$O/ob" "$OB" ;;
        foreign) cp "$OB" "$O/ob" ;;
    esac
    before=$(cat "$O/ob")
    if [[ $what == foreign ]]; then
        # someone else's outbox, through `test -O` (the repo's other-user seam)
        (cd "$P" && OSS_T_FOREIGN="$OB" run_capped 60 /bin/bash -c 'test() { if [[ "${1:-}" == -O && "${2:-}" == "$OSS_T_FOREIGN" ]]; then return 1; fi; builtin test "$@"; }
            export -f test; "$1" command build start; "$1" push' _ "$HOOK" </dev/null >/dev/null 2>&1)
        after=$(jq -sc 'length' "$OB")
        [[ "$(calls)" == 0 && "$after" == 1 ]] && pass "$name ($what)" || fail "$name ($what)" "calls=$(calls) outbox-entries=$after"
    else
        write 1; push
        [[ $RC -eq 0 && "$(calls)" == 0 && "$(cat "$O/ob")" == "$before" ]] && pass "$name ($what)" \
            || fail "$name ($what)" "rc=$RC calls=$(calls) outside=$(cat "$O/ob")"
    fi
    rm -f "$OB"
done

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
