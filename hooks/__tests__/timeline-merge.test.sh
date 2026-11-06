#!/bin/bash
# A merged PR adds one merge line to the feature timeline: its facts from GitHub, its approval from a value file
# (radical-observability G2, B4b).
#
# @behavior After /oss:ship merges a PR, the prompt writes approval.txt into the value folder (oss-value.sh dir)
#           and runs `oss-value.sh timeline merge`. The feature's timeline.ndjson gains one `merge` line whose
#           PR number, merge commit, merge time and merger come from `gh pr view`, and whose approval is the
#           value file's (none when there is no file). When GitHub cannot say (no gh, gh fails or hangs, the PR
#           is not merged), a local `merge-unknown` line is written instead, never sent to the API. A value
#           file's content never reaches gh's command line, and approval.txt is deleted once read.
# @business-rule AC-G2-003.1 and 003.2 (the merge facts come from GitHub, the approval names how the merge was
#           allowed), P-1 (values reach the merge verb only through value files), P-2 (merge-unknown is local
#           only), P-9 (gh is bounded at 10 s by the inline supervisor), the API's merge schema (sha 40 lower
#           hex, login ^[A-Za-z0-9-]{1,39}$, approval decision + uuid v4, merge-flag, chat-instruction or none).
# Usage: /bin/bash hooks/__tests__/timeline-merge.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OV="$ROOT/hooks/oss-value.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running timeline-merge tests..."

T=$(cd "$(mktemp -d /tmp/oss-timeline-merge.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.oss"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_PROJECT_DIR OSS_TL_SESSION
export CLAUDE_CODE_SESSION_ID=merge-sess-1

# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
source "$ROOT/hooks/__tests__/lib/run-capped.sh"   # the one time cap a test may use (T49)
API="$T/api-fake"; fake_api_install "$API"   # no config.json: nothing is sent, and any curl reaches only the fake

# The fake gh (the acceptance test's interface): it records each argv in $T/gh/argv (its GIT_* variables in
# $T/gh/env, its GH_* variables in $T/gh/ghenv) and answers `pr view` from
# $T/gh/reply (a JSON document), with exit status $T/gh/rc; when $T/gh/hang exists it sleeps 60 s instead.
mkdir -p "$T/gh/bin"
cat > "$T/gh/bin/gh" << 'GH'
#!/bin/bash
d="$(dirname "$0")/.."
printf '%s\n' "$*" >> "$d/argv"
env | grep '^GIT_' > "$d/env"
env | grep '^GH_' > "$d/ghenv"
[[ -e "$d/hang" ]] && exec sleep 60
[[ "$1 $2" == "pr view" ]] || exit 1
cat "$d/reply"
exit "$(cat "$d/rc")"
GH
chmod +x "$T/gh/bin/gh"
SHA=0123456789abcdef0123456789abcdef01234567
MERGED='{"number":4242,"state":"MERGED","mergeCommit":{"oid":"'$SHA'"},"mergedAt":"2026-11-06T09:30:00Z","mergedBy":{"login":"octo-dev"}}'
# reply <json> [rc]: what the fake gh answers next
reply() { printf '%s\n' "$1" > "$T/gh/reply"; printf '%s\n' "${2:-0}" > "$T/gh/rc"; rm -f "$T/gh/hang"; }
reply "$MERGED"
export PATH="$T/gh/bin:$API/bin:$PATH"
# path_without <dir> <name>...: a folder of links to every tool on this PATH except those names, first one wins
path_without() {
    local out=$1 dir f n; shift
    mkdir -p "$out"
    IFS=: read -r -a dirs <<< "$PATH"
    for dir in "${dirs[@]}"; do
        for f in "$dir"/*; do
            n=${f##*/}
            [[ " $* " == *" $n "* || -e "$out/$n" || ! -x "$f" || -d "$f" ]] || ln -s "$f" "$out/$n"
        done
    done
}
path_without "$T/nogh" gh              # "gh is not installed"
path_without "$T/stock" gh gtimeout timeout   # stock macOS (the fake gh goes first): the bound is the inline perl supervisor (P-9)

# a product repo on feat/demo/build with the demo feature folder
P="$T/product"; mkdir -p "$P/.oss/dev/active/demo"
(cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/build)
TL="$P/.oss/dev/active/demo/timeline.ndjson"
export CLAUDE_PROJECT_DIR="$P"
D=$(cd "$P" && "$OV" dir 2>/dev/null)
[[ -d "$D" ]] || { echo "oss-value.sh dir printed no folder"; exit 1; }

# approve <text>: approval.txt as a prompt writes it
approve() { printf '%s\n' "$1" > "$D/approval.txt"; }
# merge [PATH]: the verb as a served prompt runs it -> RC, ERR, SECS
merge() {
    local t0=$SECONDS
    (cd "$P" && PATH="${1:-$PATH}" run_capped 40 "$OV" timeline merge > /dev/null 2> "$T/err"); RC=$?
    ERR=$(cat "$T/err"); SECS=$((SECONDS - t0))
}
lines() { local c=0; [[ -f "$TL" ]] && c=$(wc -l < "$TL" | tr -d ' '); echo "$c"; }
last() { tail -n 1 "$TL" 2>/dev/null; }
facts() { last | jq -c '{kind, feature, session, pr, sha, mergedAt, mergedBy, approval}' 2>/dev/null; }
UUID=3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d
# G1's decision record for the demo feature, as oss-decision-record.sh writes it: the one decision this feature has
DREC="$P/.oss/dev/active/demo/decisions.ndjson"
printf '%s\n' '{"v":1,"id":"'$UUID'","feature":"demo","question":"Ship it?","answer":"Yes"}' > "$DREC"
# ago <seconds> <file>: sets the file's mtime that many seconds back (BSD date -r, else GNU date -d)
ago() {
    local t=$(($(date +%s) - $1)) s
    s=$(date -r "$t" +%Y%m%d%H%M.%S 2>/dev/null || date -d "@$t" +%Y%m%d%H%M.%S) && touch -t "$s" "$2"
}

# --- the facts come from gh pr view -------------------------------------------------------------------------------
: > "$T/gh/argv"; approve merge-flag; merge
keys=$(last | jq -c 'keys' 2>/dev/null)
[[ $RC -eq 0 && $(lines) -eq 1 \
    && "$(facts)" == '{"kind":"merge","feature":"demo","session":"merge-sess-1","pr":4242,"sha":"'$SHA'","mergedAt":"2026-11-06T09:30:00Z","mergedBy":"octo-dev","approval":{"type":"merge-flag"}}' \
    && "$keys" == '["approval","feature","id","kind","mergedAt","mergedBy","pr","session","sha","ts","v"]' \
    && "$(cat "$T/gh/argv")" == 'pr view --json number,mergeCommit,mergedAt,mergedBy' ]] \
    && pass "should take pr, sha, mergedAt and mergedBy from gh pr view --json number,mergeCommit,mergedAt,mergedBy" \
    || fail "should take pr, sha, mergedAt and mergedBy from gh pr view --json number,mergeCommit,mergedAt,mergedBy" \
        "rc=$RC lines=$(lines) got=$(facts) keys=$keys argv=$(cat "$T/gh/argv") err=$ERR"

# --- the approval table -------------------------------------------------------------------------------------------
ok=1 bad=""
for a in merge-flag chat-instruction none; do
    before=$(lines); approve "$a"; merge
    [[ $RC -eq 0 && $(lines) -eq $((before + 1)) && "$(last | jq -c .approval)" == '{"type":"'$a'"}' && ! -e "$D/approval.txt" ]] \
        || { ok=0; bad="$bad accepted=$a rc=$RC"; }
done
before=$(lines); approve "decision:$UUID"; merge
[[ $RC -eq 0 && $(lines) -eq $((before + 1)) && "$(last | jq -c .approval)" == '{"type":"decision","decisionId":"'$UUID'"}' ]] \
    || { ok=0; bad="$bad accepted=decision rc=$RC got=$(last | jq -c .approval)"; }
for a in MERGE-FLAG merged approved '' 'none none' 'merge-flag;x' decision "decision:" "decision:$(printf '%s' "$UUID" | tr a-f A-F)" \
    "decision:3f2b8c1e-9a4d-1c7b-8e21-5d6f7a8b9c0d" "decision:3f2b8c1e-9a4d-4c7b-7e21-5d6f7a8b9c0d" "decision:$UUID " "decision: $UUID" \
    "decision:${UUID}0" "type:merge-flag"; do
    before=$(lines); approve "$a"; merge
    # refused: no merge line, only the local merge-unknown trace (Task 12)
    [[ $RC -ne 0 && $(lines) -eq $((before + 1)) && "$(last | jq -r .kind)" == merge-unknown && ! -e "$D/approval.txt" ]] \
        || { ok=0; bad="$bad refused=[$a] rc=$RC left=$([[ -e "$D/approval.txt" ]] && echo yes)"; }
done
[[ $ok -eq 1 ]] && pass "should read approval.txt as merge-flag, chat-instruction, none or decision:<lower-case uuid v4>, and refuse anything else" \
    || fail "should read approval.txt as merge-flag, chat-instruction, none or decision:<lower-case uuid v4>, and refuse anything else" "$bad (err=$ERR)"

# --- no approval.txt ----------------------------------------------------------------------------------------------
rm -f "$D/approval.txt"; before=$(lines); merge
[[ $RC -eq 0 && $(lines) -eq $((before + 1)) && "$(last | jq -c '[.kind, .approval]')" == '["merge",{"type":"none"}]' ]] \
    && pass "should record approval none when approval.txt is missing" \
    || fail "should record approval none when approval.txt is missing" "rc=$RC got=$(last) err=$ERR"

# --- merge-unknown ------------------------------------------------------------------------------------------------
ok=1 bad=""
# unknown <case> <want-fields>: one merge-unknown line with exactly those own fields
unknown() {
    [[ $RC -eq 0 && $(lines) -eq $((before + 1)) && "$(last | jq -c '[.kind, .feature, (del(.v, .id, .ts, .kind, .feature, .session))]')" == '["merge-unknown","demo",'"$2"']' ]] \
        || { ok=0; bad="$bad $1: rc=$RC line=$(last)"; }
}
before=$(lines); approve merge-flag; merge "$T/nogh"; unknown no-gh '{}'
[[ ! -e "$D/approval.txt" ]] || { ok=0; bad="$bad no-gh-left-approval"; }
reply '{"message":"no pull requests found"}' 1; before=$(lines); approve merge-flag; merge; unknown gh-fails '{}'
reply 'not json at all'; before=$(lines); merge; unknown gh-garbage '{}'
reply '{"number":4242,"mergeCommit":null,"mergedAt":null,"mergedBy":null}'; before=$(lines); approve none; merge; unknown not-merged '{"pr":4242}'
# Task 8 queues the lines for the API: a merge-unknown line must never be among them (P-2)
queued=$(cat "$HOME"/.oss/timeline-outbox/*.ndjson 2>/dev/null | grep -c 'merge-unknown')
calls=$(grep -c '^timeline ' "$API/api/calls" 2>/dev/null)
[[ "${queued:-0}" -eq 0 && "${calls:-0}" -eq 0 ]] || { ok=0; bad="$bad queued=$queued calls=$calls"; }
[[ $ok -eq 1 ]] && pass "should write a local merge-unknown line, and queue nothing for the API, when gh is missing, fails or reports the PR is not merged" \
    || fail "should write a local merge-unknown line, and queue nothing for the API, when gh is missing, fails or reports the PR is not merged" "$bad (err=$ERR)"
reply "$MERGED"

# --- GitHub's facts are held to the API's patterns ----------------------------------------------------------------
# A merged PR whose facts fail the schema is still a merge that happened: a local merge-unknown line (P-2), with the
# PR number when that number is valid, never a merge line and never nothing (Task 11).
ok=1 bad=""
for r in "${MERGED/$SHA/${SHA:0:39}}" "${MERGED/$SHA/${SHA}0}" "${MERGED/$SHA/0123456789ABCDEF0123456789ABCDEF01234567}" \
    "${MERGED/octo-dev/octo_dev}" "${MERGED/octo-dev/$(printf 'a%.0s' {1..40})}" "${MERGED/octo-dev/octo dev}" "${MERGED/octo-dev/}" \
    "${MERGED/octo-dev/renovate[bot]}" "${MERGED/\{\"oid\":\"$SHA\"\}/null}" "${MERGED/2026-11-06T09:30:00Z/2019-12-31T23:59:59Z}" \
    "${MERGED/2026-11-06T09:30:00Z/yesterday}"; do
    reply "$r"; before=$(lines); approve merge-flag; merge; unknown "reply=[$r]" '{"pr":4242}'
done
for r in "${MERGED/4242/0}" "${MERGED/4242/\"4242\"}"; do
    reply "$r"; before=$(lines); approve merge-flag; merge; unknown "reply=[$r]" '{}'
done
queued=$(cat "$HOME"/.oss/timeline-outbox/*.ndjson 2>/dev/null | grep -c 'merge-unknown')
[[ "${queued:-0}" -eq 0 ]] || { ok=0; bad="$bad queued=$queued"; }
reply "$MERGED"; before=$(lines); merge
[[ $RC -eq 0 && $(lines) -eq $((before + 1)) && "$(last | jq -r .mergedBy)" == octo-dev ]] || { ok=0; bad="$bad anchor rc=$RC"; }
[[ $ok -eq 1 ]] && pass "should write a local merge-unknown line when gh's facts fail the schema (a bad sha, a bot or bad login, a null mergeCommit, a mergedAt before 2020 or not a time), with the pr when it is valid" \
    || fail "should write a local merge-unknown line when gh's facts fail the schema (a bad sha, a bot or bad login, a null mergeCommit, a mergedAt before 2020 or not a time), with the pr when it is valid" "$bad (err=$ERR)"

# --- decision:<uuid> only when the id is in this feature's decision record ---------------------------------------
ok=1 bad=""
OTHER=7a1c2e3f-4b5d-4e6f-9a0b-1c2d3e4f5a6b
# refused_merge <case>: rc != 0, no merge line but one local merge-unknown line (Task 12), approval.txt gone
refused_merge() {
    [[ $RC -ne 0 && $(lines) -eq $((before + 1)) && "$(last | jq -r .kind)" == merge-unknown && ! -e "$D/approval.txt" ]] \
        || { ok=0; bad="$bad $1: rc=$RC line=$(last)"; }
}
before=$(lines); approve "decision:$UUID"; merge
[[ $RC -eq 0 && $(lines) -eq $((before + 1)) && "$(last | jq -c .approval)" == '{"type":"decision","decisionId":"'$UUID'"}' ]] \
    || { ok=0; bad="$bad in-record: rc=$RC"; }
before=$(lines); approve "decision:$OTHER"; merge; refused_merge not-in-record
# the id named only inside another field, or only in another feature's record, is not this feature's decision
mkdir -p "$P/.oss/dev/active/other"; printf '%s\n' '{"v":1,"id":"'$OTHER'","feature":"other"}' > "$P/.oss/dev/active/other/decisions.ndjson"
printf '%s\n' '{"v":1,"id":"0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e","question":"'$OTHER'"}' >> "$DREC"
before=$(lines); approve "decision:$OTHER"; merge; refused_merge other-field-or-feature
rm -rf "$P/.oss/dev/active/other"
# a record that is a symlink or has a second hard link is never read
cp "$DREC" "$T/drec-real"; mv "$DREC" "$T/drec-keep"; ln -s "$T/drec-real" "$DREC"
before=$(lines); approve "decision:$UUID"; merge; refused_merge symlinked-record
rm -f "$DREC"; cp "$T/drec-keep" "$DREC"; ln "$DREC" "$T/drec-hardlink"
before=$(lines); approve "decision:$UUID"; merge; refused_merge hard-linked-record
rm -f "$T/drec-hardlink"
# no record at all
mv "$DREC" "$T/drec-keep"; before=$(lines); approve "decision:$UUID"; merge; refused_merge no-record
mv "$T/drec-keep" "$DREC"
[[ $ok -eq 1 ]] && pass "should accept decision:<uuid> only when that id is in this feature's decision record, and otherwise refuse the approval and write only a local merge-unknown line" \
    || fail "should accept decision:<uuid> only when that id is in this feature's decision record, and otherwise refuse the approval and write only a local merge-unknown line" "$bad (err=$ERR)"

# --- a value file older than 10 minutes is never reused ----------------------------------------------------------
ok=1 bad=""
before=$(lines); approve chat-instruction; ago 660 "$D/approval.txt"; merge; refused_merge stale-11-min
before=$(lines); approve chat-instruction; ago 540 "$D/approval.txt"; merge
[[ $RC -eq 0 && $(lines) -eq $((before + 1)) && "$(last | jq -c .approval)" == '{"type":"chat-instruction"}' ]] || { ok=0; bad="$bad fresh-9-min: rc=$RC"; }
[[ $ok -eq 1 ]] && pass "should refuse an approval.txt older than 10 minutes, and delete it" \
    || fail "should refuse an approval.txt older than 10 minutes, and delete it" "$bad (err=$ERR)"

# --- gh runs with every GIT_* variable unset ---------------------------------------------------------------------
rm -f "$T/gh/env"; approve merge-flag
(export GIT_DIR="$T/elsewhere/.git" GIT_WORK_TREE="$T/elsewhere" GIT_INDEX_FILE="$T/elsewhere/index" GIT_COMMON_DIR="$T/elsewhere/.git" \
    GIT_NAMESPACE=x GIT_OBJECT_DIRECTORY="$T/elsewhere/objects" GIT_CEILING_DIRECTORIES=/ GIT_SOME_FUTURE_VAR=1; merge)
genv=$(cat "$T/gh/env" 2>/dev/null)
[[ -f "$T/gh/env" && -z "$genv" && "$(last | jq -r .kind)" == merge ]] && pass "should run gh with every GIT_* variable unset" \
    || fail "should run gh with every GIT_* variable unset" "gh saw: [$genv] line=$(last)"

# --- gh runs with GH_REPO and GH_HOST unset, so it reports this repo's PR; the sign-in tokens stay ----------------
rm -f "$T/gh/ghenv"; approve merge-flag
(export GH_REPO=evil/other GH_HOST=evil.example GH_TOKEN=tok-signed-in GH_ENTERPRISE_TOKEN=tok-enterprise; merge)
ghenv=$(cat "$T/gh/ghenv" 2>/dev/null)
[[ -f "$T/gh/ghenv" && "$ghenv" != *GH_REPO=* && "$ghenv" != *GH_HOST=* \
    && $'\n'"$ghenv"$'\n' == *$'\n'GH_TOKEN=tok-signed-in$'\n'* \
    && $'\n'"$ghenv"$'\n' == *$'\n'GH_ENTERPRISE_TOKEN=tok-enterprise$'\n'* \
    && "$(last | jq -r .kind)" == merge ]] && pass "should run gh with GH_REPO and GH_HOST unset" \
    || fail "should run gh with GH_REPO and GH_HOST unset" "gh saw: [$ghenv] line=$(last)"

# --- nothing from a value file on gh's command line ---------------------------------------------------------------
: > "$T/gh/argv"
for a in "decision:$UUID" merge-flag chat-instruction; do approve "$a"; merge; done
leak=$(grep -E "$UUID|merge-flag|chat-instruction|decision" "$T/gh/argv")
calls=$(grep -c . "$T/gh/argv")
others=$(grep -vx 'pr view --json number,mergeCommit,mergedAt,mergedBy' "$T/gh/argv")
[[ -z "$leak" && "$calls" -eq 3 && -z "$others" ]] && pass "should never pass a value file's content to gh" \
    || fail "should never pass a value file's content to gh" "calls=$calls leak=$leak others=$others"

# --- gh is given 10 s ---------------------------------------------------------------------------------------------
touch "$T/gh/hang"; before=$(lines); approve merge-flag; merge "$T/gh/bin:$T/stock"
[[ $RC -eq 0 && $SECS -ge 9 && $SECS -le 16 && $(lines) -eq $((before + 1)) && "$(last | jq -r .kind)" == merge-unknown \
    && ! -e "$T/stock/timeout" && ! -e "$T/stock/gtimeout" ]] \
    && pass "should give up on gh after 10 s" \
    || fail "should give up on gh after 10 s" "rc=$RC (124: the test's cap, 125: a process left behind) secs=$SECS line=$(last) err=$ERR"
rm -f "$T/gh/hang"

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
