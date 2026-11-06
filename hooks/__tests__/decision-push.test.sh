#!/bin/bash
# A person's picker answers go to their OSS account from a private outbox on their own machine.
#
# @behavior When a person answers a question, the hook writes the answer to the feature's committed record
#           AND notes its id in a private outbox under ~/.oss (outside the repo, owner-only). The push sends
#           only the answers in that outbox, each as the body stored when it was written (never re-read from the record), and writes every result
#           (stored, refused, failed, conflict) back to the outbox, never to the committed record. Answers a
#           teammate committed, or lines a hostile repo planted, are never sent under this person's key.
# @business-rule radical-observability PR 3 ship round 1 (user decisions 2026-10-30): push from a local
#           outbox, not the committed file; push state stays local (no account email in git, no forgeable
#           marker); two sessions never send the same answer twice; a run is bounded (8 POSTs, ~40 s);
#           nothing is retried forever; an answer counts as stored only when the API names the account.
#
# The REAL hook from this checkout runs on REAL captured PostToolUse payloads, with a sandbox HOME whose
# OSS config points at a fake API (a `curl` first on PATH: hooks/__tests__/fake-oss-api.sh) and an
# obviously fake key.
# Usage: ./hooks/__tests__/decision-push.test.sh
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
# The fake API (fake-oss-api.sh) stands at a plain-http loopback apiUrl: that needs the opt-in (T20).
export OSS_ALLOW_HTTP_LOOPBACK=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$ROOT/hooks/oss-decision-record.sh"
FIX="$ROOT/hooks/__tests__/fixtures/ask-user-question"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

T=$(cd "$(mktemp -d /tmp/oss-decision-push.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_CODE_SESSION_ID
P="$T/product"; mkdir -p "$P/.oss/dev/active/demo"
(cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/build)
printf '{"currentCommand":"build"}\n' > "$P/.oss/workflow-state.json"
export CLAUDE_PROJECT_DIR="$P"
REC="$P/.oss/dev/active/demo/decisions.ndjson"
mkdir -p "$T/home/.oss"

# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
source "$ROOT/hooks/__tests__/lib/run-capped.sh"   # the one time cap a test may use (T49)
FAKE_KEY='fake-oss-key-0000feedface0042'
API="$T/api-fake"; fake_api_install "$API"
AH="$T/api-home"; mkdir -p "$AH/.oss"
printf '{"apiKey":"%s","apiUrl":"http://127.0.0.1:9"}\n' "$FAKE_KEY" > "$AH/.oss/config.json"
# the outbox of this record: ~/.oss/decisions-outbox/<16 hex of the record's physical path>.ndjson
OB_DIR="$AH/.oss/decisions-outbox"
OB="$OB_DIR/$(printf '%s' "$REC" | shasum -a 256 | cut -c1-16).ndjson"
# Task 16s: the fingerprint of a key (16 hex of its sha-256) that each outbox entry stores, never the key itself
fp_of() { printf '%s' "$1" | shasum -a 256 | cut -c1-16; }
FP=$(fp_of "$FAKE_KEY")

mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
# api_reset: a fresh fake API (no calls, empty queues), a fresh record, no outbox, no ~/.oss/run
api_reset() { rm -rf "$API/api" "$AH/.oss/run" "$OB_DIR"; mkdir -p "$API/api"; rm -f "$REC"; }
# api_reset_calls: forget the calls made so far, keeping the record and the outbox (the next run's calls only)
api_reset_calls() { local k; k=$(mktemp -d "$T/q.XXXXXX"); cp "$API"/api/queue.* "$k/" 2>/dev/null; rm -rf "$API/api"; mkdir -p "$API/api"; cp "$k"/* "$API/api/" 2>/dev/null; rm -rf "$k"; }
# api_queue <policy|decisions> "<status> <body>": the next answer for that URL
api_queue() { printf '%s\n' "$2" >> "$API/api/queue.$1"; }
# push_hook [payload]: the hook as Claude Code runs it, with the API configured; the record is kept -> RC
push_hook() { (cd "$P" && HOME="$AH" PATH="$API/bin:$PATH" "$HOOK" < "${1:-$FIX/pick.json}" 2>"$T/err"); RC=$?; }
# posts: how many POSTs the API received; posted_ids: their ids, in the order sent; calls: every call
posts() { local c; c=$(grep -c '^decisions ' "$API/api/calls" 2>/dev/null); echo "${c:-0}"; }
calls() { local c; c=$(wc -l < "$API/api/calls" 2>/dev/null | tr -d ' '); echo "${c:-0}"; }
posted_ids() { jq -r '.id' "$API/api/bodies" 2>/dev/null | tr '\n' ' '; }
# answer_ids: the ids of the record's answer lines, oldest first (lines that are not JSON are skipped)
answer_ids() { jq -Rr 'fromjson? | select(.questionKey and (has("type") | not)) | .id' "$REC" 2>/dev/null | tr '\n' ' '; }
# state_of <id>: the latest outbox state of <id> ("" when the outbox never named it)
state_of() { jq -Rr --arg id "$1" 'fromjson? | select(.id == $id) | .state' "$OB" 2>/dev/null | tail -n 1; }
# seed <n> [mine]: a record of <n> answer lines (a real hook line, each with its own v4 id), and with "mine"
# each one is pending in this person's outbox with the body this machine made for it when it wrote the
# answer, under this person's key (Tasks 16a, 16s: answers this machine wrote while offline)
seed() {
    api_reset
    (cd "$P" && HOME="$T/home" "$HOOK" < "$FIX/pick.json" 2>/dev/null)
    jq -c --argjson n "$1" '. as $l | range($n) as $i
        | $l | .id = ("00000000-0000-4000-8000-" + ("00000000000" + ($i | tostring))[-12:])' "$REC" > "$T/seed" && mv "$T/seed" "$REC"
    if [[ "${2:-}" == mine ]]; then
        mkdir -p "$OB_DIR"; chmod 700 "$OB_DIR"
        local l
        while IFS= read -r l; do
            printf '%s\n' "$l" | node "$ROOT/watcher/dist/cli/redact-decision.js" --push-body | jq -c --arg fp "$FP" '{id, state: "pending", fp: $fp, body: .}' >> "$OB"
        done < "$REC"
        chmod 600 "$OB"
    fi
}

# ===== Task 15a: push only what this machine wrote =====================================================
name='should send only the answer this machine wrote: 13 planted records and 1 real answer make exactly 1 POST'
seed 13; push_hook
mine=$(answer_ids | tr ' ' '\n' | grep . | tail -n 1)
[[ $RC -eq 0 && $(answer_ids | wc -w) -eq 14 && "$(posts)" == 1 && "$(posted_ids)" == "$mine " ]] && pass "$name" \
    || fail "$name" "rc=$RC answers=$(answer_ids | wc -w) posts=$(posts) sent=$(posted_ids) mine=$mine"

name='should keep the outbox at ~/.oss/decisions-outbox/<16 hex>.ndjson, folder 700 and file 600, pending (with the body sent) then verified'
api_reset; push_hook
id=$(answer_ids | tr -d ' ')
got=$(jq -sc 'map(del(.body))' "$OB" 2>/dev/null)
# Task 16w: the body sent is the stored body plus keyFp, the fingerprint the entry was written under
[[ "$(head -n 1 "$OB" | jq -c .body)" == "$(head -n 1 "$API/api/bodies" | jq -c 'del(.keyFp)')" ]] || got="stored body is not the body sent: $got"
[[ "$(head -n 1 "$API/api/bodies" | jq -r .keyFp)" == "$FP" ]] || got="keyFp sent is not the entry's fp: $got"
want=$(jq -nc --arg id "$id" --arg fp "$FP" '[{id: $id, state: "pending", fp: $fp}, {id: $id, state: "verified", account: "acct-fake-1"}]')
[[ $RC -eq 0 && -n "$id" && "$got" == "$want" && "$(mode_of "$OB_DIR")" == 700 && "$(mode_of "$OB")" == 600 && ! -L "$OB" ]] && pass "$name" \
    || fail "$name" "rc=$RC outbox=$(ls "$OB_DIR" 2>/dev/null | tr '\n' ' ') got=$got want=$want modes=$(mode_of "$OB_DIR" 2>/dev/null)/$(mode_of "$OB" 2>/dev/null)"

# ===== Task 16a: the push sends what this machine wrote, never what the repo says now ======================
name='should send the body this machine stored, not a same-id line committed after a failed POST'
api_reset; api_queue decisions '000 unreachable'; push_hook
mine=$(answer_ids | tr -d ' ')
orig=$(head -n 1 "$REC" | node "$ROOT/watcher/dist/cli/redact-decision.js" --push-body | jq -c --arg fp "$FP" '.keyFp = $fp')  # 16w: + keyFp
planted=$(jq -c '.choice = "Apple" | .notes = "planted by someone else"' "$REC"); printf '%s\n' "$planted" >> "$REC"
api_reset_calls; push_hook
got=$(jq -c --arg id "$mine" 'select(.id == $id)' "$API/api/bodies" 2>/dev/null)
[[ $RC -eq 0 && -n "$mine" && -n "$orig" && "$got" == "$orig" && "$(state_of "$mine")" == verified ]] && pass "$name" \
    || fail "$name" "rc=$RC sent=$got want=$orig state=$(state_of "$mine")"

name='should not refuse or change my answer when a same-id line filed under another feature is committed'
seed 1 mine; mine=$(answer_ids | tr -d ' ')
orig=$(head -n 1 "$REC" | node "$ROOT/watcher/dist/cli/redact-decision.js" --push-body | jq -c --arg fp "$FP" '.keyFp = $fp')  # 16w: + keyFp
planted=$(jq -c '.feature = "someone-else" | .choice = "Apple"' "$REC"); printf '%s\n' "$planted" >> "$REC"
push_hook
got=$(jq -c --arg id "$mine" 'select(.id == $id)' "$API/api/bodies" 2>/dev/null)
[[ $RC -eq 0 && "$got" == "$orig" && "$(state_of "$mine")" == verified ]] && pass "$name" \
    || fail "$name" "rc=$RC sent=$got want=$orig state=$(state_of "$mine")"

name='should mark a pending outbox entry with no stored body (an older outbox) failed, and never send it'
seed 1; old=$(answer_ids | tr -d ' ')
mkdir -p -m 700 "$OB_DIR"; jq -nc --arg id "$old" '{id: $id, state: "pending"}' > "$OB"; chmod 600 "$OB"
push_hook
[[ $RC -eq 0 && "$(posts)" == 1 && "$(posted_ids)" != *"$old"* && "$(state_of "$old")" == failed && "$(mode_of "$OB")" == 600 ]] && pass "$name" \
    || fail "$name" "rc=$RC posts=$(posts) sent=$(posted_ids) state=$(state_of "$old") mode=$(mode_of "$OB")"

name='should record the answer but send nothing when the outbox folder or file is a symlink'
for what in folder file; do
    api_reset; O=$(mktemp -d "$T/outside.XXXXXX")
    if [[ $what == folder ]]; then ln -s "$O" "$OB_DIR"; else mkdir -m 700 "$OB_DIR"; : > "$O/ob"; ln -s "$O/ob" "$OB"; fi
    push_hook
    [[ $RC -eq 0 && "$(posts)" == 0 && $(answer_ids | wc -w) -eq 1 && -z "$(cat "$O"/* 2>/dev/null)" ]] && pass "$name ($what)" \
        || fail "$name ($what)" "rc=$RC posts=$(posts) answers=$(answer_ids | wc -w) outside=$(cat "$O"/* 2>/dev/null | head -c 200)"
    rm -rf "$OB_DIR"
done

# ===== Task 16q: committed lines cannot stop my answer being sent ========================================
# answerIndex counts the committed lines with the same question, which anyone with the repo can add; the API
# takes at most 100, so the count stops there and the answer is still sent
name='should still send my answer, with answerIndex 100, when the record holds 100+ committed lines for the same question'
seed 105; push_hook
mine=$(answer_ids | tr ' ' '\n' | grep . | tail -n 1)
got=$(jq -c --arg id "$mine" 'select(.id == $id) | .answerIndex' "$API/api/bodies" 2>/dev/null)
[[ $RC -eq 0 && "$(posts)" == 1 && "$got" == 100 && "$(state_of "$mine")" == verified ]] && pass "$name" \
    || fail "$name" "rc=$RC posts=$(posts) answerIndex-sent=$got state=$(state_of "$mine")"

# ===== Task 16r: committed content cannot silently switch recording off ===================================
# the record lock lives in ~/.oss/locks, outside the repo, so a committed decisions.ndjson.lock means nothing
name='should still record and send my answer when a decisions.ndjson.lock file or folder is committed'
for kind in file folder; do
    api_reset
    if [[ $kind == file ]]; then printf 'x\n' > "$REC.lock"; else mkdir "$REC.lock"; : > "$REC.lock/.gitkeep"; fi
    push_hook
    [[ $RC -eq 0 && $(answer_ids | wc -w) -eq 1 && "$(posts)" == 1 && ! -s "$T/err" ]] && pass "$name ($kind)" \
        || fail "$name ($kind)" "rc=$RC answers=$(answer_ids | wc -w) posts=$(posts) stderr=$(cat "$T/err")"
    rm -rf "$REC.lock"
done

# a linked feature folder is still refused (security), and the refusal is kept where status can show it
name='should refuse a symlinked feature folder, and /oss:settings decisions status should show that refusal'
api_reset; O=$(mktemp -d "$T/outside.XXXXXX"); mv "$P/.oss/dev/active/demo" "$O/demo"; ln -s "$O/demo" "$P/.oss/dev/active/demo"
push_hook; c=$(calls)
st=$(HOME="$AH" PATH="$API/bin:$PATH" "$ROOT/hooks/oss-decisions-policy.sh" status 2>/dev/null </dev/null)
rm "$P/.oss/dev/active/demo"; mv "$O/demo" "$P/.oss/dev/active/demo"
[[ $RC -eq 0 && ! -e "$O/demo/decisions.ndjson" && "$c" == 0 && "$st" == *"refused"*"symlink"* ]] && pass "$name" \
    || fail "$name" "rc=$RC written-outside=$([[ -e "$O/demo/decisions.ndjson" ]] && echo yes || echo no) calls=$c status=$st"
rm -f "$AH/.oss/decisions-refusal.json"

# ===== Task 16s/16w: queued answers are sent only under the account that answered (user decisions 2026-10-31) ==
# Task 16w changed 16s's first test: an answer given under an earlier key is no longer withheld on this machine
# (that dropped every unsent answer when a key was rotated on the same account). It is POSTed with keyFp, the
# fingerprint it was written under, and the server, which knows which keys are one account's, answers 409
# account_mismatch when it is another account's (next test). Before: 1 POST (B's), A withheld. Now: 2 POSTs.
name='should send an answer given under an earlier key once the config holds a new one, with keyFp naming the earlier key, never the key'
KEY_B='fake-oss-key-1111beefcafe0043'
api_reset; api_queue policy '000 unreachable'; push_hook
a_id=$(answer_ids | tr -d ' '); a_fp=$(jq -r --arg id "$a_id" 'select(.id == $id and .state == "pending") | .fp' "$OB" 2>/dev/null)
printf '{"apiKey":"%s","apiUrl":"http://127.0.0.1:9"}\n' "$KEY_B" > "$AH/.oss/config.json"
api_reset_calls; push_hook
b_id=$(answer_ids | cut -d' ' -f2)
a_sent=$(jq -r --arg id "$a_id" 'select(.id == $id) | .keyFp' "$API/api/bodies" 2>/dev/null)
b_sent=$(jq -r --arg id "$b_id" 'select(.id == $id) | .keyFp' "$API/api/bodies" 2>/dev/null)
[[ $RC -eq 0 && "$a_fp" == "$FP" && "$(posts)" == 2 && "$(posted_ids)" == "$a_id $b_id " && "$a_sent" == "$FP" && "$b_sent" == "$(fp_of "$KEY_B")" \
    && "$(state_of "$a_id")" == verified && "$(state_of "$b_id")" == verified ]] \
    && ! grep -qF -e "$FAKE_KEY" -e "$KEY_B" "$OB" "$API/api/bodies" && pass "$name" \
    || fail "$name" "rc=$RC fp-of-A=$a_fp want=$FP posts=$(posts) sent=$(posted_ids) keyFp-A=$a_sent keyFp-B=$b_sent A=$a_id:$(state_of "$a_id") B=$b_id:$(state_of "$b_id") key-in-outbox-or-body=$(cat "$OB" "$API/api/bodies" | grep -cF -e "$FAKE_KEY" -e "$KEY_B")"
printf '{"apiKey":"%s","apiUrl":"http://127.0.0.1:9"}\n' "$FAKE_KEY" > "$AH/.oss/config.json"

name='should withhold only the answer a POST answers 409 account_mismatch for, send the rest in the same run, and never send it again'
seed 2 mine; first=$(answer_ids | cut -d' ' -f1)
# the oldest waiting answer was given under another account's key (the fake's FAKE_ACCOUNT_FPS names this one's)
jq -c --arg id "$first" --arg fp "$(fp_of 'fake-oss-key-2222other-account')" 'if .id == $id and .state == "pending" then .fp = $fp else . end' "$OB" > "$T/ob" && cat "$T/ob" > "$OB"
export FAKE_ACCOUNT_FPS="$FP"; push_hook
all=$(answer_ids); rest=$(for i in $(answer_ids | cut -d' ' -f2-); do state_of "$i"; done | sort -u | tr '\n' ' ')
st=$(state_of "$first"); sent1=$(posted_ids)
api_reset_calls; push_hook; unset FAKE_ACCOUNT_FPS
[[ $RC -eq 0 && "$st" == withheld && "$sent1" == "$all" && "$rest" == "verified " && "$(posted_ids)" != *"$first"* ]] && pass "$name" \
    || fail "$name" "rc=$RC first=$first:$st sent=$sent1 want=$all rest-states=$rest next-run-sent=$(posted_ids)"

# ===== Task 16aa: an answer given while the team was off is withheld alone; later answers are still sent ===
# The API answers 409 answered_while_off for one answer that predates the team's re-enable cutoff; policy_off
# still means "the team is off now" and withholds everything. Before: B was withheld with A and never sent.
name='should withhold only the answer given before the team turned recording back on, and still store the newer one'
seed 2 mine; a=$(answer_ids | cut -d' ' -f1); b=$(answer_ids | cut -d' ' -f2)
# A was answered on 2026-01-01, B on 2026-03-01; the team turned recording back on on 2026-02-01
jq -c --arg a "$a" --arg b "$b" 'if .state == "pending" then
        (if .id == $a then .body.answeredAt = "2026-01-01T00:00:00.000Z" elif .id == $b then .body.answeredAt = "2026-03-01T00:00:00.000Z" else . end)
    else . end' "$OB" > "$T/ob" && cat "$T/ob" > "$OB"
# (the hook run itself adds a third answer, answered now, so after the cutoff too)
FAKE_OFF_BEFORE='2026-02-01T00:00:00.000Z'; export FAKE_OFF_BEFORE; push_hook; unset FAKE_OFF_BEFORE
all=$(answer_ids); now=$(answer_ids | cut -d' ' -f3)
[[ $RC -eq 0 && -n "$a" && -n "$b" && -n "$now" && "$(posts)" == 3 && "$(posted_ids)" == "$all" \
    && "$(state_of "$a")" == withheld && "$(state_of "$b")" == verified && "$(state_of "$now")" == verified ]] && pass "$name" \
    || fail "$name" "rc=$RC posts=$(posts) sent=$(posted_ids) want=$all A=$(state_of "$a") B=$(state_of "$b") now=$(state_of "$now")"

name='should withhold, and never send, a pending answer that names no key (an older outbox)'
seed 1 mine; old=$(answer_ids | tr -d ' ')
jq -c 'del(.fp)' "$OB" > "$T/ob" && cat "$T/ob" > "$OB"
push_hook
[[ $RC -eq 0 && "$(posts)" == 1 && "$(posted_ids)" != *"$old"* && "$(state_of "$old")" == withheld ]] && pass "$name" \
    || fail "$name" "rc=$RC posts=$(posts) sent=$(posted_ids) state=$(state_of "$old")"

# ===== Task 16d: the outbox is one link, checked before every append ======================================
name='should append nothing to another file, and POST nothing, when the outbox is a hardlink to it'
seed 1 mine; O=$(mktemp -d "$T/outside.XXXXXX"); mv "$OB" "$O/other"; ln "$O/other" "$OB"
before=$(cat "$O/other"); push_hook
[[ $RC -eq 0 && "$(posts)" == 0 && "$(cat "$O/other")" == "$before" && $(answer_ids | wc -w) -eq 2 ]] && pass "$name" \
    || fail "$name" "rc=$RC posts=$(posts) other-grew-by=$(($(wc -l < "$O/other") - $(printf '%s\n' "$before" | wc -l)))"
name='should stop the run, appending nothing, when the outbox becomes a hardlink while it pushes'
seed 2 mine; O=$(mktemp -d "$T/outside.XXXXXX")
# at the first POST (call 2: call 1 is the policy GET) the outbox is swapped for a hardlink to a file elsewhere
printf '#!/bin/bash\n[[ $1 == 2 ]] && mv "%s" "%s/other" && ln "%s/other" "%s" && wc -l < "%s/other" > "%s/lines"\nexit 0\n' "$OB" "$O" "$O" "$OB" "$O" "$O" > "$T/swap"
chmod +x "$T/swap"
(cd "$P" && HOME="$AH" PATH="$API/bin:$PATH" FAKE_ON_CALL="$T/swap" "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
[[ $RC -eq 0 && "$(posts)" == 1 && -s "$O/lines" && $(wc -l < "$O/other") -eq $(cat "$O/lines") ]] && pass "$name" \
    || fail "$name" "rc=$RC posts=$(posts) lines-at-swap=$(cat "$O/lines" 2>/dev/null) lines-now=$(wc -l < "$O/other" 2>/dev/null)"
rm -f "$OB"

name='should append no pending entry, and POST nothing, when the outbox becomes a hardlink while the answer is written'
seed 1 mine; O=$(mktemp -d "$T/outside.XXXXXX"); SN="$T/swap-node"; mkdir -p "$SN"
# a node that swaps the outbox for a hardlink to a file elsewhere when the push body is made (under the record lock)
printf '#!/bin/bash\nfor a in "$@"; do [[ "$a" == --push-body && ! -e "%s/other" ]] && mv "%s" "%s/other" && ln "%s/other" "%s"; done\nexec "%s" "$@"\n' \
    "$O" "$OB" "$O" "$O" "$OB" "$(command -v node)" > "$SN/node"
chmod +x "$SN/node"
(cd "$P" && HOME="$AH" PATH="$API/bin:$SN:$PATH" "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
[[ $RC -eq 0 && -e "$O/other" && "$(posts)" == 0 && $(wc -l < "$O/other") -eq 1 ]] && pass "$name" \
    || fail "$name" "rc=$RC swapped=$([[ -e "$O/other" ]] && echo yes || echo no) posts=$(posts) other-lines=$(wc -l < "$O/other" 2>/dev/null)"
rm -f "$OB"

# ===== Task 15b: push state stays local =================================================================
name='should still send a pending answer when the record holds a committed refused or verified line for it'
for t in refused verified; do
    seed 1 mine; id=$(answer_ids | tr -d ' ')
    jq -nc --arg id "$id" --arg t "$t" '{type: $t, id: $id, status: 400, account: null}' >> "$REC"
    push_hook
    [[ $RC -eq 0 && "$(posted_ids)" == "$id "* && "$(state_of "$id")" == verified ]] && pass "$name ($t)" \
        || fail "$name ($t)" "rc=$RC sent=$(posted_ids) state=$(state_of "$id")"
done

name='should add no marker line to the record, and write the account email nowhere in the repo'
api_reset; push_hook
api_queue decisions '400 {"error":"invalid"}'; push_hook; push_hook
got=$(jq -Rsc '[split("\n")[] | fromjson? | if has("type") then .type else .answerIndex end]' "$REC" 2>/dev/null)
[[ $RC -eq 0 && "$got" == '[1,2,3]' ]] && ! grep -rqF 'dev@example.invalid' "$P" && pass "$name" \
    || fail "$name" "rc=$RC lines=$got email-in-repo=$(grep -rlF 'dev@example.invalid' "$P" 2>/dev/null | tr '\n' ' ')"

name='should send each answer once when two sessions push at the same time'
bad=0; why=""
for r in 1 2 3; do
    seed 4 mine
    for _ in 1 2; do (cd "$P" && HOME="$AH" PATH="$API/bin:$PATH" FAKE_DELAY_DECISIONS=0.2 "$HOOK" < "$FIX/pick.json" 2>/dev/null) & done
    wait
    push_hook   # a later run sends whatever the busy one left pending
    dups=$(jq -r '.id' "$API/api/bodies" 2>/dev/null | sort | uniq -d | wc -l | tr -d ' ')
    sent=$(jq -r '.id' "$API/api/bodies" 2>/dev/null | sort -u | wc -l | tr -d ' ')
    [[ "$dups" == 0 && "$sent" == 7 ]] || { bad=$((bad + 1)); why+=" run $r: $dups sent twice, $sent of 7 sent;"; }
done
[[ $bad -eq 0 ]] && pass "$name (3 races)" || fail "$name (3 races)" "$bad of 3 went wrong:$why"

# ===== Task 15e: progress is saved per response, and a run has a deadline ================================
name='should write each result to the outbox as soon as its response comes, before the next POST'
seed 3 mine
(cd "$P" && HOME="$AH" PATH="$API/bin:$PATH" FAKE_SNAP_EACH="$OB" "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
first=$(jq -r '.id' "$API/api/bodies" 2>/dev/null | head -n 1)
n2=$(grep -n '^decisions ' "$API/api/calls" 2>/dev/null | sed -n 2p | cut -d: -f1)
got=$(jq -Rr --arg id "$first" 'fromjson? | select(.id == $id) | .state' "$API/api/each.$n2" 2>/dev/null | tail -n 1)
[[ $RC -eq 0 && -n "$first" && -n "$n2" && "$got" == verified ]] && pass "$name" \
    || fail "$name" "rc=$RC first=$first second-post-call=$n2 outbox-at-second-post=$(tr '\n' ' ' < "$API/api/each.$n2" 2>/dev/null)"

name='should send at most 8 answers in one run, the oldest first'
seed 12 mine; push_hook
want=$(answer_ids | cut -d' ' -f1-8)
[[ $RC -eq 0 && "$(posts)" == 8 && "$(posted_ids)" == "$want " ]] && pass "$name" \
    || fail "$name" "rc=$RC posts=$(posts) sent-oldest-8=$([[ "$(posted_ids)" == "$want " ]] && echo yes || echo no)"

# (each POST takes 14 s: the third ends past 40 s, so no fourth starts; this test takes about 45 s)
name='should start no new POST once about 40 seconds have passed'
seed 5 mine
start=$SECONDS
(cd "$P" && HOME="$AH" PATH="$API/bin:$PATH" FAKE_DELAY_DECISIONS=14 "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
took=$((SECONDS - start))
[[ $RC -eq 0 && "$(posts)" == 3 ]] && pass "$name" || fail "$name" "rc=$RC posts=$(posts) took=${took}s"

# ===== Task 13 (ported from oss-decision-record.test.sh; results now live in the outbox) ==================
name='should POST the redacted record to /api/v1/decisions through oss_api_curl, with the key never in argv'
api_reset; push_hook
n=$(grep -n '^decisions ' "$API/api/calls" 2>/dev/null | head -n 1 | cut -d: -f1)
want=$(head -n 1 "$REC" 2>/dev/null | node "$ROOT/watcher/dist/cli/redact-decision.js" --push-body 2>/dev/null | jq -c --arg fp "$FP" '.keyFp = $fp')  # 16w: + keyFp
got=$(cat "$API/api/body.$n" 2>/dev/null)
[[ $RC -eq 0 && "$(posts)" == 1 && "$(sed -n "${n}p" "$API/api/calls" 2>/dev/null)" == "decisions http://127.0.0.1:9/api/v1/decisions" && -n "$want" && "$got" == "$want" ]] \
    && ! grep -qF "$FAKE_KEY" "$API"/api/argv.* && grep -qF "Authorization: Bearer $FAKE_KEY" "$API/api/config.$n" \
    && grep -qF -- '--max-time 5' "$API/api/argv.$n" && grep -qF 'Content-Type: application/json' "$API/api/argv.$n" \
    && pass "$name" || fail "$name" "rc=$RC posts=$(posts) calls=$(tr '\n' ' ' < "$API/api/calls" 2>/dev/null) body-matches=$([[ -n "$want" && "$got" == "$want" ]] && echo yes || echo no)"

name='should mark an answer verified in the outbox, with the account id only, after a 201 or 200'
# the account as the API sent it, with a control character and a zero-width space that must not reach the outbox
for c in '201|{"account":{"id":"acct-9","email":"dev@example.invalid"}}|acct-9' \
         '200|{"account":{"id":"acct\u001b[31m-9​","email":"dev@example.invalid"}}|acct[31m-9'; do
    IFS='|' read -r code resp acct <<< "$c"
    api_reset; api_queue decisions "$code $resp"; push_hook
    id=$(answer_ids | tr -d ' ')
    got=$(jq -Rc 'fromjson? | select(.state == "verified")' "$OB" 2>/dev/null)
    want=$(jq -nc --arg id "$id" --arg a "$acct" '{id: $id, state: "verified", account: $a}')
    [[ $RC -eq 0 && -n "$id" && "$got" == "$want" ]] && ! grep -qF 'dev@example.invalid' "$OB" && pass "$name ($code)" \
        || fail "$name ($code)" "rc=$RC got=$got want=$want"
done

name='should send nothing when the policy endpoint does not say the push is on'
for c in '200 {"pushEnabled":"true"}' '200 not json' '404 {"error":"not_found"}' '500 {"pushEnabled":true}' '000 unreachable'; do
    api_reset; api_queue policy "$c"; push_hook
    id=$(answer_ids | tr -d ' ')
    [[ $RC -eq 0 && "$(posts)" == 0 && $(grep -c '^policy ' "$API/api/calls" 2>/dev/null) -eq 1 && $(wc -l < "$REC") -eq 1 && "$(state_of "$id")" == pending ]] \
        && pass "$name, and the answer stays pending ($c)" \
        || fail "$name, and the answer stays pending ($c)" "rc=$RC posts=$(posts) calls=$(tr '\n' ' ' < "$API/api/calls" 2>/dev/null) state=$(state_of "$id")"
done

name='should leave the answer pending and exit 0 when the API is unreachable or returns 5xx'
for c in '000 unreachable' '500 {"error":"internal"}' '503 <html>busy</html>'; do
    api_reset; api_queue decisions "$c"; push_hook
    id=$(answer_ids | tr -d ' ')
    [[ $RC -eq 0 && "$(posts)" == 1 && $(wc -l < "$REC") -eq 1 && "$(state_of "$id")" != verified ]] && pass "$name ($c)" \
        || fail "$name ($c)" "rc=$RC posts=$(posts) state=$(state_of "$id") stderr=$(cat "$T/err")"
done

name='should re-send pending answers on the next run, oldest first, and never one already verified'
seed 3 mine; v=$(answer_ids | cut -d' ' -f2)
jq -nc --arg id "$v" '{id: $id, state: "verified", account: "acct-fake-1"}' >> "$OB"
printf '%s\n' '<<<<<<< HEAD' >> "$REC"
push_hook
want="$(answer_ids | cut -d' ' -f1) $(answer_ids | cut -d' ' -f3-)"
[[ $RC -eq 0 && "$(posts)" == 3 && "$(posted_ids)" == "$want" ]] && pass "$name" \
    || fail "$name" "rc=$RC posts=$(posts) sent=$(posted_ids) want=$want"

name='should never put a secret into the POST body'
tok="gh""p_$(printf 'K7m2P9q4%.0s' 1 2 3 4 5)"
jq --arg t "$tok" '.tool_response.questions[0].question as $q
    | .tool_response.answers[$q] = ("use " + $t + " for now")
    | .tool_response.annotations[$q] = {notes: ("token " + $t)}' "$FIX/other.json" > "$T/push-secret.json"
api_reset; push_hook "$T/push-secret.json"
got=$(jq -c '[.choice, .notes]' "$API/api/bodies" 2>/dev/null)
[[ $RC -eq 0 && "$(posts)" == 1 && "$got" == '[["use [REDACTED] for now"],"token [REDACTED]"]' ]] && ! grep -rqF "$tok" "$API/api" "$OB_DIR" && pass "$name" \
    || fail "$name" "rc=$RC posts=$(posts) sent=$(printf '%s' "$got" | sed "s/$tok/<TOKEN>/g")"

name='should finish writing the repo line before any network call'
api_reset; (cd "$P" && HOME="$AH" PATH="$API/bin:$PATH" FAKE_SNAP="$REC" "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
got=$(jq -c '[.id, .choice]' "$API/api/snap" 2>/dev/null); want=$(head -n 1 "$REC" | jq -c '[.id, .choice]' 2>/dev/null)
[[ $RC -eq 0 && -n "$want" && $(wc -l < "$API/api/snap" 2>/dev/null) -eq 1 && "$got" == "$want" ]] && pass "$name" \
    || fail "$name" "rc=$RC record-at-first-call=$(cat "$API/api/snap" 2>/dev/null || echo '<none>') want=$want"

name='should stop sending for this run on a 429 and leave the rest pending for the next run'
seed 3 mine; api_queue decisions '429 {"error":"rate_limited"}'; push_hook
first=$(answer_ids | cut -d' ' -f1)
[[ $RC -eq 0 && "$(posts)" == 1 && "$(posted_ids)" == "$first " && -z "$(jq -Rc 'fromjson? | select(.state != "pending")' "$OB" 2>/dev/null)" ]] \
    && pass "$name (this run stops at the 429)" || fail "$name (this run stops at the 429)" "rc=$RC posts=$(posts) outbox=$(cat "$OB" 2>/dev/null | tr '\n' ' ')"
push_hook
[[ $RC -eq 0 && "$(posted_ids)" == "$first $(answer_ids)" ]] && pass "$name (the next run sends them all)" \
    || fail "$name (the next run sends them all)" "rc=$RC sent=$(posted_ids)"

name='should leave the answers pending on a 403 (inactive subscription) without retrying in the same run'
for c in '403 {"error":"subscription_inactive"}' '500 {"error":"internal"}' '000 unreachable' '302 moved'; do
    seed 3 mine; api_queue decisions "$c"; push_hook
    [[ $RC -eq 0 && "$(posts)" == 1 && -z "$(jq -Rc 'fromjson? | select(.state == "verified")' "$OB" 2>/dev/null)" ]] && pass "$name ($c)" \
        || fail "$name ($c)" "rc=$RC posts=$(posts) outbox=$(cat "$OB" 2>/dev/null | tr '\n' ' ')"
done

name='should mark an answer the API refuses (400) in the outbox and never resend it'
seed 2 mine; api_queue decisions '400 {"error":"invalid"}'; push_hook
first=$(answer_ids | cut -d' ' -f1)
got=$(jq -Rc --arg id "$first" 'fromjson? | select(.id == $id and .state == "refused")' "$OB" 2>/dev/null)
[[ $RC -eq 0 && "$(posts)" == 3 && "$got" == "$(jq -nc --arg id "$first" '{id: $id, state: "refused", status: 400}')" ]] && pass "$name (marked, the run goes on)" \
    || fail "$name (marked, the run goes on)" "rc=$RC posts=$(posts) marker=$got"
api_reset_calls; push_hook
[[ $RC -eq 0 && "$(posted_ids)" != *"$first"* && "$(posts)" == 1 ]] && pass "$name (never sent again)" || fail "$name (never sent again)" "rc=$RC sent=$(posted_ids)"

name='should stop the run on any other 409 without marking anything'
for c in '409 not json' '409 {"error":"something_new"}'; do
    seed 2 mine; api_queue decisions "$c"; push_hook
    [[ $RC -eq 0 && "$(posts)" == 1 && -z "$(jq -Rc 'fromjson? | select(.state != "pending")' "$OB" 2>/dev/null)" ]] && pass "$name ($c)" \
        || fail "$name ($c)" "rc=$RC posts=$(posts) outbox=$(cat "$OB" 2>/dev/null | tr '\n' ' ')"
done

name='should leave the body file nowhere after the run'
seed 2 mine; push_hook
paths=$(cat "$API"/api/bodypath.* 2>/dev/null | sort -u); modes=$(cat "$API"/api/mode.* 2>/dev/null | sort -u | tr '\n' ' ')
outs=$(cat "$API"/api/argv.* 2>/dev/null | grep -o -- '-o [^ ]*' | cut -c4- | sort -u)
under() { local p; [[ -n "$1" ]] || return 1; while IFS= read -r p; do [[ "$p" == "$AH/.oss/run/"?*/* ]] || return 1; done <<< "$1"; }
left=$(find "$AH/.oss/run" -mindepth 1 2>/dev/null)
# T74c: the answers come through curl's stdout (oss_capped), so curl writes no -o file; one it did write would be there
[[ $RC -eq 0 && "$(posts)" == 3 ]] && under "$paths" && { [[ -z "$outs" ]] || under "$outs"; } && [[ "$modes" == "600 " && -z "$left" && -d "$AH/.oss/run" ]] \
    && pass "$name (made 600 in a private folder under ~/.oss/run, removed on exit)" \
    || fail "$name (made 600 in a private folder under ~/.oss/run, removed on exit)" "rc=$RC posts=$(posts) modes=$modes left=$left"
api_reset; O=$(mktemp -d "$T/outside.XXXXXX"); ln -s "$O" "$AH/.oss/run"; push_hook
[[ $RC -eq 0 && "$(posts)" == 0 && -z "$(ls -A "$O")" && $(wc -l < "$REC") -eq 1 ]] && pass "$name (a symlinked ~/.oss/run: no push)" \
    || fail "$name (a symlinked ~/.oss/run: no push)" "rc=$RC posts=$(posts) outside=$(ls -A "$O" | tr '\n' ' ')"
rm -f "$AH/.oss/run"


# ===== Task 15f: nothing is retried forever ===============================================================
name='should make no network call at all, and keep no outbox entry, for an answer with no feature (unfiled)'
api_reset; Q=$(mktemp -d "$T/p.XXXXXX"); mkdir -p "$Q/.oss/dev/active"
(cd "$Q" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init)
(cd "$Q" && CLAUDE_PROJECT_DIR="$Q" HOME="$AH" PATH="$API/bin:$PATH" "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
U="$Q/.oss/dev/decisions-unfiled.ndjson"
[[ $RC -eq 0 && "$(calls)" == 0 && $(wc -l < "$U" 2>/dev/null) -eq 1 && -z "$(cat "$OB_DIR"/*.ndjson 2>/dev/null)" \
    && "$(jq -c '[.feature, .person.status]' "$U" 2>/dev/null)" == '[null,"unverified"]' ]] && pass "$name" \
    || fail "$name" "rc=$RC calls=$(calls) outbox=$(cat "$OB_DIR"/*.ndjson 2>/dev/null | tr '\n' ' ') record=$(cat "$U" 2>/dev/null)"

# a node that redacts the record as usual but cannot make a push body (fails, or prints nothing)
NB="$T/node-bin"; mkdir -p "$NB"; REAL_NODE=$(command -v node)
name='should mark an answer refused (status 0) in the outbox when it is written, and never try it again, when no push body can be made'
for how in 'exit 2' 'exit 0' 'echo "{\"id\":1}"; exit 2' 'echo "not json"; exit 0'; do
    printf '#!/bin/bash\nfor a in "$@"; do [[ "$a" == --push-body ]] && { cat >/dev/null; echo try >> "%s/tries"; %s; }; done\nexec "%s" "$@"\n' "$NB" "$how" "$REAL_NODE" > "$NB/node"
    chmod +x "$NB/node"; rm -f "$NB/tries"
    api_reset
    (cd "$P" && HOME="$AH" PATH="$API/bin:$NB:$PATH" "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
    first=$(answer_ids | tr -d ' ')
    (cd "$P" && HOME="$AH" PATH="$API/bin:$NB:$PATH" "$HOOK" < "$FIX/pick.json" 2>"$T/err")
    states=$(for i in $(answer_ids); do state_of "$i"; done | sort -u | tr '\n' ' ')
    statuses=$(jq -Rr 'fromjson? | select(.state == "refused") | .status' "$OB" 2>/dev/null | sort -u | tr '\n' ' ')
    tries=$(wc -l < "$NB/tries" 2>/dev/null | tr -d ' ')
    # one try per answer, when it was written: the first answer is not tried again by the second run
    [[ $RC -eq 0 && -n "$first" && "$(posts)" == 0 && "$states" == "refused " && "$statuses" == "0 " && "$tries" == 2 ]] && pass "$name ($how)" \
        || fail "$name ($how)" "rc=$RC posts=$(posts) states=$states statuses=$statuses tries=$tries"
done

name='should mark an answer failed after a 5xx on 3 separate runs, and then send the newer ones'
seed 1 mine; A=$(answer_ids | tr -d ' ')
api_queue decisions '500 {"error":"internal"}'; push_hook; after1=$(state_of "$A")
api_queue decisions '502 bad gateway'; push_hook; after2=$(state_of "$A")
api_queue decisions '503 busy'; push_hook; after3=$(state_of "$A")
api_reset_calls; push_hook
want=$(answer_ids | cut -d' ' -f2-)
[[ $RC -eq 0 && "$after1" != failed && "$after2" != failed && "$after3" == failed && "$(posted_ids)" == "$want" ]] && pass "$name" \
    || fail "$name" "rc=$RC states=$after1/$after2/$after3 run4-sent=$(posted_ids) want=$want"

name='should not count 429, 403 or an unreachable API toward failing an answer'
seed 1 mine; A=$(answer_ids | tr -d ' ')
for c in '429 {"error":"rate_limited"}' '403 {"error":"subscription_inactive"}' '000 unreachable'; do
    api_queue decisions "$c"; push_hook
done
st=$(state_of "$A"); api_reset_calls; push_hook
[[ $RC -eq 0 && "$st" == pending && "$(posted_ids)" == "$A "* ]] && pass "$name" || fail "$name" "rc=$RC state=$st next-run-sent=$(posted_ids)"

name='should mark a 409 conflict in the outbox, say once on stderr that the answer was not sent (without its text), and go on'
seed 2 mine; first=$(answer_ids | cut -d' ' -f1)
api_queue decisions '409 {"error":"conflict"}'; push_hook
q=$(jq -r '.question' "$REC" | head -n 1)
[[ $RC -eq 0 && "$(state_of "$first")" == conflict && "$(posts)" == 3 && $(wc -l < "$T/err" | tr -d ' ') == 1 && "$(cat "$T/err")" == oss:* ]] \
    && ! grep -qF "${q:0:20}" "$T/err" && ! grep -qF Banana "$T/err" && pass "$name" \
    || fail "$name" "rc=$RC state=$(state_of "$first") posts=$(posts) stderr=$(cat "$T/err")"
api_reset_calls; push_hook
[[ "$(posted_ids)" != *"$first"* ]] && pass "$name (never sent again)" || fail "$name (never sent again)" "sent=$(posted_ids)"

# ===== Task 16b: an answer given while the team push is off is never sent (user decision 2026-10-30) =======
name='should never send an answer given while the team push was off, even after the team turns it back on'
api_reset; api_queue policy '200 {"pushEnabled":false,"team":true}'; push_hook
off_id=$(answer_ids | tr -d ' '); st=$(state_of "$off_id")
api_reset_calls; push_hook
new_id=$(answer_ids | cut -d' ' -f2)
[[ $RC -eq 0 && "$st" == withheld && "$(posts)" == 1 && "$(posted_ids)" == "$new_id " && "$(state_of "$off_id")" == withheld ]] && pass "$name" \
    || fail "$name" "rc=$RC state-after-off=$st posts=$(posts) sent=$(posted_ids) off=$off_id new=$new_id"

name='should withhold every waiting answer when a POST answers 409 policy_off, and send only newer ones later'
seed 2 mine; api_queue decisions '409 {"error":"policy_off"}'; push_hook
states=$(for i in $(answer_ids); do state_of "$i"; done | sort -u | tr '\n' ' ')
api_reset_calls; push_hook
newest=$(answer_ids | cut -d' ' -f4)
[[ $RC -eq 0 && "$states" == "withheld " && "$(posted_ids)" == "$newest " ]] && pass "$name" \
    || fail "$name" "rc=$RC states=$states next-run-sent=$(posted_ids) newest=$newest"

# ===== Task 15g: stored only when the API names the account =============================================
name='should not count a 200/201 without a non-empty account id as stored, and stop the run'
for r in '201 {"stored":true}' '201 {"account":{"id":""}}' '200 {"account":{"id":7}}' '201 {"account":null}' '201 not json'; do
    seed 2 mine; api_queue decisions "$r"; push_hook
    [[ $RC -eq 0 && "$(posts)" == 1 && -z "$(jq -Rc 'fromjson? | select(.state != "pending")' "$OB" 2>/dev/null)" ]] && pass "$name ($r)" \
        || fail "$name ($r)" "rc=$RC posts=$(posts) outbox=$(cat "$OB" 2>/dev/null | tr '\n' ' ')"
done

# ===== Task 15c: the personal switch ======================================================================
name='should make no network call, and keep no outbox entry, when the person turned the push off on this machine'
api_reset; printf '{"notifications":{"style":"none"},"decisionsPush":false}\n' > "$AH/.oss/settings.json"; push_hook
off_calls=$(calls); off_ob=$(cat "$OB" 2>/dev/null)
[[ $RC -eq 0 && "$off_calls" == 0 && -z "$off_ob" && $(answer_ids | wc -w) -eq 1 ]] && pass "$name" \
    || fail "$name" "rc=$RC calls=$off_calls outbox=$off_ob answers=$(answer_ids | wc -w)"
name='should not send, once switched back on, an answer given while the push was off'
off_id=$(answer_ids | tr -d ' ')
printf '{"decisionsPush":true}\n' > "$AH/.oss/settings.json"; push_hook
[[ $RC -eq 0 && "$(posts)" == 1 && "$(posted_ids)" != *"$off_id"* ]] && pass "$name" || fail "$name" "rc=$RC posts=$(posts) sent=$(posted_ids) off-answer=$off_id"
rm -f "$AH/.oss/settings.json"

# ===== Task 16c: the personal switch fails closed ===========================================================
# a settings file that cannot be read as exactly one JSON object is "cannot tell", and that means no push; a
# missing file is the default (on). Duplicate keys in one object: the last one wins (jq's rule).
name='should make no network call when the personal switch cannot be read'
SF="$AH/.oss/settings.json"
for c in 'trailing comma|{"decisionsPush":true,}' 'top-level false|false' 'a list|[false]' 'two documents|{"decisionsPush":true}{"notifications":{}}' \
         'empty file|' 'mode 000|{"decisionsPush":true}' 'duplicate keys, false last|{"decisionsPush":true,"decisionsPush":false}'; do
    IFS='|' read -r what content <<< "$c"
    if [[ $what == 'mode 000' && $(id -u) == 0 ]]; then echo "  (skipped: $what, running as root)"; continue; fi
    api_reset; printf '%s' "$content" > "$SF"; [[ $what == 'mode 000' ]] && chmod 000 "$SF"
    push_hook
    [[ $RC -eq 0 && "$(calls)" == 0 && -z "$(cat "$OB" 2>/dev/null)" && $(answer_ids | wc -w) -eq 1 ]] && pass "$name ($what)" \
        || fail "$name ($what)" "rc=$RC calls=$(calls) outbox=$(cat "$OB" 2>/dev/null | head -c 100)"
    chmod 600 "$SF"; rm -f "$SF"
done
name='should push when the settings file is missing, or one object whose last decisionsPush is not false'
for c in 'missing|' 'duplicate keys, true last|{"decisionsPush":false,"decisionsPush":true}' 'other settings only|{"notifications":{"style":"none"}}'; do
    IFS='|' read -r what content <<< "$c"
    api_reset; [[ $what != missing ]] && printf '%s\n' "$content" > "$SF"
    push_hook
    [[ $RC -eq 0 && "$(posts)" == 1 ]] && pass "$name ($what)" || fail "$name ($what)" "rc=$RC posts=$(posts)"
    rm -f "$SF"
done

# ===== Task 16al: the personal off switch survives an older settings.json renamed over it ================
# off (the real /oss:settings decisions off) writes ~/.oss/decisions-push-off; a writer suspended past the settings
# lock's stale limit then renames an older settings.json over the file. The marker still says off.
MK="$AH/.oss/decisions-push-off"
switch() { HOME="$AH" PATH="$API/bin:$PATH" "$ROOT/hooks/oss-decisions-policy.sh" "$1" >/dev/null 2>&1 </dev/null; }
name='should push nothing after decisions off, even once an older settings.json is renamed over the file'
for older in '{"decisionsPush":true}' missing; do
    api_reset; api_queue policy '200 {"pushEnabled":false}'; switch off
    if [[ $older == missing ]]; then rm -f "$SF"; else printf '%s\n' "$older" > "$AH/.oss/old.json"; mv -f "$AH/.oss/old.json" "$SF"; fi
    api_reset_calls; rm -f "$API/api/queue.policy"; push_hook
    [[ $RC -eq 0 && -f "$MK" && "$(calls)" == 0 && -z "$(cat "$OB" 2>/dev/null)" && $(answer_ids | wc -w) -eq 1 ]] && pass "$name (settings: $older)" \
        || fail "$name (settings: $older)" "rc=$RC marker=$(ls -l "$MK" 2>&1) calls=$(calls) outbox=$(head -c 100 "$OB" 2>/dev/null)"
done
name='should push again after decisions on removes the off marker'
api_reset; api_queue policy '200 {"pushEnabled":false}'; switch off; api_queue policy '200 {"pushEnabled":true}'; switch on
api_reset_calls; push_hook
[[ $RC -eq 0 && ! -e "$MK" && "$(posts)" == 1 ]] && pass "$name" || fail "$name" "rc=$RC marker=$(ls -l "$MK" 2>&1) posts=$(posts)"
rm -f "$SF"
name='should push nothing when the off marker is a symlink, and leave its target alone'
api_reset; O=$(mktemp -d "$T/outside.XXXXXX"); printf 'keep\n' > "$O/target"; ln -s "$O/target" "$MK"; push_hook
[[ $RC -eq 0 && "$(calls)" == 0 && -z "$(cat "$OB" 2>/dev/null)" && "$(cat "$O/target")" == keep ]] && pass "$name" \
    || fail "$name" "rc=$RC calls=$(calls) target=$(cat "$O/target")"
rm -f "$MK"

# ===== Task 67: a FIFO under ~/.oss cannot hang a picker answer, and never turns the push on ===============
# @behavior A person answers a question while ~/.oss/decisions-push-off or ~/.oss/settings.json is a FIFO; the
#           answer is recorded, the hook finishes, and nothing is sent.
# @business-rule Fail closed (#214 Task 16al): anything at the off marker is off, and the marker is never opened;
#           a settings.json that is not a regular file cannot be read, and that is off too.
name='should finish, record the answer and send nothing when a FIFO stands in a switch file'
for c in "fifo marker|$MK" "fifo settings|$SF"; do
    IFS='|' read -r what at <<< "$c"
    api_reset; rm -f "$MK" "$SF"
    mkfifo "$at"
    (cd "$P" && HOME="$AH" PATH="$API/bin:$PATH" run_capped 20 "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
    [[ $RC -eq 0 && "$(calls)" == 0 && -z "$(cat "$OB" 2>/dev/null)" && $(answer_ids | wc -w) -eq 1 ]] && pass "$name ($what)" \
        || fail "$name ($what)" "rc=$RC calls=$(calls) outbox=$(head -c 100 "$OB" 2>/dev/null)"
    rm -f "$MK" "$SF"
done

# ===== Task 70: a linked settings.json is followed to a regular file, as 2.0.96 did =========================
# @behavior A person whose dotfiles manager (stow, chezmoi, yadm) links ~/.oss/settings.json answers a question;
#           the push reads the linked file like any settings file: on unless it says decisionsPush false.
# @business-rule 2.0.96 parity (user: "Follow the link", as check-updates does, T53b): a link to a regular file
#           is read; a link to a FIFO, a device, a folder or nothing cannot tell, and that is off, never a hang.
name='should follow a linked settings.json to a regular file: on unless it says off'
for c in 'no decisionsPush key|{"notifications":{"style":"none"}}|1' 'decisionsPush false|{"decisionsPush":false}|0'; do
    IFS='|' read -r what content want <<< "$c"
    api_reset; rm -f "$SF"; printf '%s\n' "$content" > "$T/real-settings"; ln -s "$T/real-settings" "$SF"
    (cd "$P" && HOME="$AH" PATH="$API/bin:$PATH" run_capped 20 "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
    [[ $RC -eq 0 && "$(posts)" == "$want" && ( $want == 1 || "$(calls)" == 0 ) && $(answer_ids | wc -w) -eq 1 ]] && pass "$name ($what)" \
        || fail "$name ($what)" "rc=$RC posts=$(posts) calls=$(calls)"
    rm -f "$SF" "$T/real-settings"
done
name='should finish, record the answer and send nothing when settings.json links to no regular file'
for what in 'link to a FIFO' 'link to /dev/zero' 'dangling link' 'link to a folder' 'a folder'; do
    api_reset; rm -rf "$SF" "$T/target"
    case $what in
        'link to a FIFO') mkfifo "$T/target"; ln -s "$T/target" "$SF" ;;
        'link to /dev/zero') ln -s /dev/zero "$SF" ;;
        'dangling link') ln -s "$T/target" "$SF" ;;
        'link to a folder') mkdir "$T/target"; ln -s "$T/target" "$SF" ;;
        'a folder') mkdir "$SF" ;;
    esac
    (cd "$P" && HOME="$AH" PATH="$API/bin:$PATH" run_capped 20 "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
    [[ $RC -eq 0 && "$(calls)" == 0 && -z "$(cat "$OB" 2>/dev/null)" && $(answer_ids | wc -w) -eq 1 ]] && pass "$name ($what)" \
        || fail "$name ($what)" "rc=$RC calls=$(calls) outbox=$(head -c 100 "$OB" 2>/dev/null)"
    rm -rf "$SF" "$T/target"
done

# ===== Task 16am: a push run stops as soon as the person switches off =====================================
# @behavior A person turns the push off while a run is sending; no further answer leaves the machine in that run.
# @business-rule The personal switch is read again before every POST; off stops the run, and what was not sent
#           stays pending (it is not withheld: turning back on later sends it, as before the run).
name='should send no further POST once the personal switch turns off mid-run, leaving the rest pending'
seed 2 mine
# at the first POST (call 2: call 1 is the policy GET) the person turns the push off on this machine
printf '#!/bin/bash\n[[ $1 == 2 ]] && printf "{\\"decisionsPush\\":false}\\n" > "%s"\nexit 0\n' "$SF" > "$T/flip-off"
chmod +x "$T/flip-off"
(cd "$P" && HOME="$AH" PATH="$API/bin:$PATH" FAKE_ON_CALL="$T/flip-off" "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
ids=$(answer_ids); first=$(posted_ids | tr -d ' ')
states=""; for i in $ids; do [[ "$i" == "$first" ]] || states+="$(state_of "$i") "; done
[[ $RC -eq 0 && "$(posts)" == 1 && "$(state_of "$first")" == verified && "$states" == "pending pending " ]] && pass "$name" \
    || fail "$name" "rc=$RC posts=$(posts) first=$(state_of "$first") rest=$states"
rm -f "$SF"

# ===== Task 15j: a push lock left by a hook that was killed does not stop pushes forever ==================
name='should take over a push lock older than 2 minutes, and leave a fresh one alone'
for age in 200 5; do
    seed 1 mine; mkdir "$OB.push"
    then_s=$(($(date +%s) - age)); stamp=$(date -r "$then_s" +%Y%m%d%H%M.%S 2>/dev/null || date -d "@$then_s" +%Y%m%d%H%M.%S)
    touch -t "$stamp" "$OB.push"; push_hook
    want=2; [[ $age == 5 ]] && want=0
    [[ $RC -eq 0 && "$(posts)" == "$want" ]] && pass "$name (${age} s old)" || fail "$name (${age} s old)" "rc=$RC posts=$(posts)"
    rmdir "$OB.push" 2>/dev/null
done

# ===== Task 16ak: only the holder releases the push lock ==================================================
# a run that held the push lock past 2 minutes may have had it taken over; on exit it leaves the new holder's
# lock in place, or a third run would push alongside the second one (the same id sent twice)
name='should leave the push lock in place on exit when another run took it over while this one pushed'
seed 1 mine
# at the first POST (call 2) another run replaces the push lock with its own fresh one (made before the old one
# goes, so it never reuses its inode)
printf '#!/bin/bash\n[[ $1 == 2 ]] && mv "%s" "%s.old" && mkdir "%s" && rmdir "%s.old" && { stat -c %%i "%s" 2>/dev/null || stat -f %%i "%s"; } > "%s"\nexit 0\n' \
    "$OB.push" "$OB.push" "$OB.push" "$OB.push" "$OB.push" "$OB.push" "$T/push-fresh" > "$T/take-push"
chmod +x "$T/take-push"; rm -f "$T/push-fresh"
(cd "$P" && HOME="$AH" PATH="$API/bin:$PATH" FAKE_ON_CALL="$T/take-push" "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
fresh=$(cat "$T/push-fresh" 2>/dev/null)
[[ $RC -eq 0 && -n "$fresh" && -d "$OB.push" && "$(stat -c %i "$OB.push" 2>/dev/null || stat -f %i "$OB.push")" == "$fresh" ]] && pass "$name" \
    || fail "$name" "rc=$RC fresh=$fresh lock=$(ls -ldi "$OB.push" 2>&1)"
rmdir "$OB.push" 2>/dev/null
name='should remove its own push lock on exit after a normal run'
seed 1 mine; push_hook
[[ $RC -eq 0 && "$(posts)" == 2 && ! -e "$OB.push" ]] && pass "$name" || fail "$name" "rc=$RC posts=$(posts) lock=$(ls -ld "$OB.push" 2>&1)"

# ===== Task 15k: leftovers in ~/.oss/run are cleared ======================================================
name='should remove decision-push folders in ~/.oss/run older than 10 minutes, and nothing else'
seed 1 mine; mkdir -p -m 700 "$AH/.oss/run"
mkdir "$AH/.oss/run/decision-push.OLD1" "$AH/.oss/run/decision-push.NEW1" "$AH/.oss/run/other.OLD1"
: > "$AH/.oss/run/decision-push.OLD1/body"
then_s=$(($(date +%s) - 1200)); stamp=$(date -r "$then_s" +%Y%m%d%H%M.%S 2>/dev/null || date -d "@$then_s" +%Y%m%d%H%M.%S)
touch -t "$stamp" "$AH/.oss/run/decision-push.OLD1" "$AH/.oss/run/other.OLD1"
push_hook
left=$(cd "$AH/.oss/run" && ls | sort | tr '\n' ' ')
[[ $RC -eq 0 && "$left" == "decision-push.NEW1 other.OLD1 " ]] && pass "$name" || fail "$name" "rc=$RC left=$left"
rm -rf "$AH/.oss/run"

# ===== T74c: an answer over the hooks' one body cap (262144 bytes, oss_capped) is no answer ==================
# A policy or a POST answer that starts as a good one but runs past the cap is never parsed: no POST on such a
# policy, no "verified" on such a POST answer (the answer stays pending for the next run); curl gets --max-filesize.
PAD=$(head -c 262144 /dev/zero | tr '\0' ' ')
name='should send nothing when the policy answer is over 262144 bytes'
api_reset; api_queue policy "200 {\"pushEnabled\":true,\"team\":false}$PAD"; push_hook
id=$(answer_ids | tr -d ' ')
[[ $RC -eq 0 && "$(posts)" == 0 && "$(calls)" == 1 && "$(state_of "$id")" == pending ]] && grep -q -- '--max-filesize 262144 ' "$API/api/argv.1" && pass "$name" \
    || fail "$name" "rc=$RC posts=$(posts) calls=$(calls) state=$(state_of "$id") argv=$(cat "$API/api/argv.1" 2>/dev/null)"
name='should not mark an answer verified when the POST answer is over 262144 bytes'
api_reset; api_queue decisions "201 {\"account\":{\"id\":\"acct-big\"}}$PAD"; push_hook
id=$(answer_ids | tr -d ' ')
[[ $RC -eq 0 && "$(posts)" == 1 && "$(state_of "$id")" == pending ]] && grep -q -- '--max-filesize 262144 ' "$API/api/argv.2" && pass "$name" \
    || fail "$name" "rc=$RC posts=$(posts) state=$(state_of "$id") argv=$(cat "$API/api/argv.2" 2>/dev/null)"

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
