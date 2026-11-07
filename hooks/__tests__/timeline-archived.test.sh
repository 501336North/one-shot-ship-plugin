#!/bin/bash
# A merge after the archive move is filed in the archived feature folder and queued for push
# (radical-observability G2, Phase B2, B7).
#
# @behavior /oss:ship moves the feature's dev docs from .oss/dev/active/<f>/ to .oss/dev/completed/<f>-YYYY-MM-DD/
#           before it merges. When the prompt then runs `oss-value.sh timeline merge`, the merge line still belongs
#           to that feature: it is appended to the archived folder's timeline.ndjson with feature "<f>", and it is
#           queued as pending in the private outbox (~/.oss/timeline-outbox/<rid>.ndjson) so it reaches the API.
#           It is not dropped into .oss/dev/timeline-unfiled.ndjson. Archived twice, the newest dated folder wins;
#           a folder that only looks like the feature's is never used; while the active folder exists it still
#           wins. Only the merge verb looks in completed/: gate, command and agent lines stay unfiled (B2-1). A
#           decision recorded before the move still approves the merge (B8), and a decision record reached through
#           a linked folder, active or archived, never does (FOLLOWUPS #197).
# @business-rule AC-G2-003.3 as amended / API ADR-017 (the merge line reaches the API after the archive move),
#           P-3 (unfiled lines are never pushed, so a merge filed as unfiled would never reach the API).
# Usage: /bin/bash hooks/__tests__/timeline-archived.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OV="$ROOT/hooks/oss-value.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running timeline-archived tests..."

T=$(cd "$(mktemp -d /tmp/oss-timeline-archived.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.oss"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_PROJECT_DIR OSS_TL_SESSION
export CLAUDE_CODE_SESSION_ID=archived-sess-1

# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
# shellcheck source=hooks/__tests__/lib/run-capped.sh
source "$ROOT/hooks/__tests__/lib/run-capped.sh"   # the one time cap a test may use (T49)
# No config.json: the writer still queues (with an empty fp) and the detached push stops at "no key", so the outbox
# entry stays pending and any curl reaches only the fake.
API="$T/api-fake"; fake_api_install "$API"

# The fake gh: records each argv in $T/gh/argv and answers `pr view` from $T/gh/reply with exit status $T/gh/rc.
mkdir -p "$T/gh/bin"
cat > "$T/gh/bin/gh" << 'GH'
#!/bin/bash
d="$(dirname "$0")/.."
printf '%s\n' "$*" >> "$d/argv"
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

# a product repo on feat/demo/ship whose demo folder was already archived: completed/demo-2026-11-07, no active/demo
P="$T/product"; mkdir -p "$P/.oss/dev/active" "$P/.oss/dev/completed/demo-2026-11-07"
(cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/ship)
CTL="$P/.oss/dev/completed/demo-2026-11-07/timeline.ndjson"
UNF="$P/.oss/dev/timeline-unfiled.ndjson"
OB_DIR="$HOME/.oss/timeline-outbox"
# one earlier gate line, written before the move
printf '%s\n' '{"v":1,"id":"7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f","ts":"2026-11-07T08:00:00Z","kind":"gate","feature":"demo","session":"archived-sess-0","round":1,"gate":"code-review","verdict":"pass","findings":{},"fixed":{},"mode":"full"}' > "$CTL"
export CLAUDE_PROJECT_DIR="$P"
D=$(cd "$P" && "$OV" dir 2>/dev/null)
[[ -d "$D" ]] || { echo "oss-value.sh dir printed no folder"; exit 1; }

# approve <text>: approval.txt as a prompt writes it
approve() { printf '%s\n' "$1" > "$D/approval.txt"; }
# merge: the verb as a served prompt runs it -> RC, ERR
merge() {
    (cd "$P" && run_capped 40 "$OV" timeline merge > /dev/null 2> "$T/err"); RC=$?
    ERR=$(cat "$T/err")
}
lines() { local c=0; [[ -f "$1" ]] && c=$(wc -l < "$1" | tr -d ' '); echo "$c"; }
outbox() { cat "$OB_DIR"/*.ndjson 2>/dev/null; }
diag() {
    echo "rc=$RC completed_lines=$(lines "$CTL") completed_last=$(tail -n 1 "$CTL" 2>/dev/null)" \
        "unfiled=$([[ -e "$UNF" ]] && echo present || echo absent) unfiled_last=$(tail -n 1 "$UNF" 2>/dev/null)" \
        "outbox=[$(outbox | head -c 600)] err=$ERR"
}

# --- B7: the merge after the archive move -------------------------------------------------------------------------
name='should file the merge line in the archived folder and queue it for push when the active folder was moved to completed/'
approve merge-flag; merge
last=$(tail -n 1 "$CTL" 2>/dev/null)
facts=$(jq -c '{kind, feature, pr, sha, mergedAt, mergedBy, approval}' <<< "$last" 2>/dev/null)
nid=$(jq -r '.id' <<< "$last" 2>/dev/null)
ob=$(outbox | jq -sc . 2>/dev/null)
if [[ $RC -eq 0 && $(lines "$CTL") -eq 2 \
    && "$facts" == '{"kind":"merge","feature":"demo","pr":4242,"sha":"'$SHA'","mergedAt":"2026-11-06T09:30:00Z","mergedBy":"octo-dev","approval":{"type":"merge-flag"}}' \
    && ! -e "$UNF" \
    && -n "$nid" && "$(jq -c 'map({id, state})' <<< "$ob" 2>/dev/null)" == '[{"id":"'$nid'","state":"pending"}]' ]]; then
    pass "$name"
else
    fail "$name" "$(diag)"
fi

# fresh <branch> [folder...]: a new product repo on <branch> holding .oss/dev/active and each folder given (relative
# to the repo), with its own value folder and an empty outbox, so no case sees another's files -> P, D, UNF
N=0
fresh() {
    N=$((N + 1)); P="$T/product$N"; mkdir -p "$P/.oss/dev/active"
    (cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b "$1")
    shift; local f; for f in "$@"; do mkdir -p "$P/$f"; done
    UNF="$P/.oss/dev/timeline-unfiled.ndjson"
    export CLAUDE_PROJECT_DIR="$P"
    D=$(cd "$P" && "$OV" dir 2>/dev/null)
    rm -rf "$OB_DIR"
}
# timelines: every timeline.ndjson under completed/, so a case can say none was written there
timelines() { find "$P/.oss/dev/completed" -name timeline.ndjson 2>/dev/null; }
# unfiled_only <kind>: rc 0, one <kind> line in the unfiled file with no feature, nothing under completed/, no outbox
unfiled_only() {
    local got; got=$(tail -n 1 "$UNF" 2>/dev/null | jq -r '.kind + " feature=" + (has("feature") | tostring)' 2>/dev/null)
    [[ $RC -eq 0 && $(lines "$UNF") -eq 1 && "$got" == "$1 feature=false" && -z "$(timelines)" && -z "$(outbox)" ]]
}
udiag() { echo "rc=$RC unfiled=[$(cat "$UNF" 2>/dev/null)] completed=[$(timelines)] outbox=[$(outbox | head -c 300)] err=$ERR"; }

# --- the fallback is merge-only: every other kind is unchanged after the archive move (DESIGN, B2-1) --------------
name='should still file a gate line as unfiled when only the archived folder exists'
fresh feat/demo/ship .oss/dev/completed/demo-2026-11-07
for kv in round=1 gate=code-review verdict=pass findings= fixed= mode=full; do printf '%s\n' "${kv#*=}" > "$D/${kv%%=*}.txt"; done
(cd "$P" && run_capped 20 "$OV" timeline gate > /dev/null 2> "$T/err"); RC=$?; ERR=$(cat "$T/err")
unfiled_only gate && pass "$name" || fail "$name" "$(udiag)"

name='should still file a command line as unfiled when only the archived folder exists'
fresh feat/demo/ship .oss/dev/completed/demo-2026-11-07
(cd "$P" && run_capped 30 /bin/bash -c 'source "$1" || exit 99; oss_timeline_append command "$2"' _ \
    "$ROOT/hooks/oss-timeline.sh" '{"command":"ship","status":"start"}' 2> "$T/err"); RC=$?; ERR=$(cat "$T/err")
unfiled_only command && pass "$name" || fail "$name" "$(udiag)"

name='should still file an agent line as unfiled when only the archived folder exists'
fresh feat/demo/ship .oss/dev/completed/demo-2026-11-07
jq -nc --arg cwd "$P" '{cwd: $cwd, hook_event_name: "PostToolUse", session_id: "archived-sess-2", tool_name: "Agent",
    tool_input: {subagent_type: "oss:code-reviewer", description: "d", prompt: "p"}}' > "$T/in"
(cd "$P" && run_capped 20 /bin/bash "$ROOT/hooks/oss-timeline.sh" < "$T/in" > /dev/null 2> "$T/err"); RC=$?; ERR=$(cat "$T/err")
unfiled_only agent && pass "$name" || fail "$name" "$(udiag)"

name='should leave oss_resolve_feature returning no feature when only the archived folder exists'
fresh feat/demo/ship .oss/dev/completed/demo-2026-11-07
got=$(cd "$P" && run_capped 10 /bin/bash -c 'source "$1" || exit 99; oss_resolve_feature "$2"; printf "[%s]" "$_OSS_FEATURE"' _ \
    "$ROOT/hooks/oss-safe-path.sh" "$P" 2>&1)
[[ "$got" == "[]" ]] && pass "$name" || fail "$name" "got=$got"

# --- B7: which archived folder the merge line goes to -------------------------------------------------------------
name='should use the newest dated folder when the feature was archived twice'
fresh feat/demo/ship .oss/dev/completed/demo-2026-11-01 .oss/dev/completed/demo-2026-11-07
approve merge-flag; merge
NEW="$P/.oss/dev/completed/demo-2026-11-07/timeline.ndjson"
last=$(tail -n 1 "$NEW" 2>/dev/null)
nid=$(jq -r '.id' <<< "$last" 2>/dev/null)
if [[ $RC -eq 0 && $(lines "$NEW") -eq 1 && "$(jq -r '.kind + " " + .feature' <<< "$last" 2>/dev/null)" == "merge demo" \
    && ! -e "$P/.oss/dev/completed/demo-2026-11-01/timeline.ndjson" && ! -e "$UNF" \
    && "$(outbox | jq -sc 'map({id, state})' 2>/dev/null)" == '[{"id":"'$nid'","state":"pending"}]' ]]; then
    pass "$name"
else
    fail "$name" "$(udiag)"
fi

name="should ignore folders that only look like the feature's"
fresh feat/demo/ship .oss/dev/completed/demo-extra-2026-11-07 .oss/dev/completed/demo-2026-1-7 \
    .oss/dev/completed/demo-2026-11-07-x .oss/dev/completed/demox-2026-11-07
approve merge-flag; merge
unfiled_only merge && pass "$name" || fail "$name" "$(udiag)"

name='should stay unfiled and never push when no archived folder matches'
fresh feat/demo/ship
approve merge-flag; merge
[[ ! -e "$P/.oss/dev/completed" ]] && unfiled_only merge && pass "$name" || fail "$name" "$(udiag)"

name='should keep filing in the active folder when it still exists'
fresh feat/demo/ship .oss/dev/active/demo .oss/dev/completed/demo-2026-11-07
approve merge-flag; merge
ATL="$P/.oss/dev/active/demo/timeline.ndjson"
if [[ $RC -eq 0 && $(lines "$ATL") -eq 1 && "$(tail -n 1 "$ATL" | jq -r '.kind + " " + .feature' 2>/dev/null)" == "merge demo" \
    && -z "$(timelines)" && ! -e "$UNF" && "$(outbox | jq -s 'length' 2>/dev/null)" == 1 ]]; then
    pass "$name"
else
    fail "$name" "rc=$RC active=[$(cat "$ATL" 2>/dev/null)] $(udiag)"
fi

# --- B7 safety: a refused archived folder means an unfiled line, rc 0, never pushed (B2-2, B2-4) ------------------
# snap <path...>: every regular file under the paths (links not followed) with its content, to show nothing changed
snap() { find "$@" -type f -print -exec cat {} + 2>/dev/null; }
# refused_unfiled <before snap> <path...>: rc 0, one merge line in unfiled with no feature, no outbox entry, and the
# archived and outside files exactly as they were
refused_unfiled() {
    local before=$1 got; shift
    got=$(tail -n 1 "$UNF" 2>/dev/null | jq -r '.kind + " feature=" + (has("feature") | tostring)' 2>/dev/null)
    [[ $RC -eq 0 && $(lines "$UNF") -eq 1 && "$got" == "merge feature=false" && -z "$(outbox)" \
        && "$(snap "$@")" == "$before" ]]
}

name='should refuse a symlinked archived folder, and never fall back to an older real one'
fresh feat/demo/ship .oss/dev/completed/demo-2026-11-01
OUT="$T/out-link-folder"; mkdir -p "$OUT"; ln -s "$OUT" "$P/.oss/dev/completed/demo-2026-11-07"
CMP="$P/.oss/dev/completed"; before=$(snap "$CMP" "$OUT")
approve merge-flag; merge
refused_unfiled "$before" "$CMP" "$OUT" && [[ ! -e "$CMP/demo-2026-11-01/timeline.ndjson" && -z "$(ls -A "$OUT")" ]] \
    && pass "$name" || fail "$name" "outside=[$(ls -A "$OUT")] $(udiag)"

name='should refuse a linked .oss/dev/completed'
fresh feat/demo/ship
OUT="$T/out-link-completed"; mkdir -p "$OUT/demo-2026-11-07"; ln -s "$OUT" "$P/.oss/dev/completed"
before=$(snap "$OUT")
approve merge-flag; merge
refused_unfiled "$before" "$OUT" && pass "$name" || fail "$name" "outside=[$(snap "$OUT")] $(udiag)"

name='should refuse an archived timeline file with another hard link'
fresh feat/demo/ship .oss/dev/completed/demo-2026-11-07
OUT="$T/out-hard-link"; mkdir -p "$OUT"; printf '%s\n' '{"elsewhere":1}' > "$OUT/tl"
ln "$OUT/tl" "$P/.oss/dev/completed/demo-2026-11-07/timeline.ndjson"
CMP="$P/.oss/dev/completed"; before=$(snap "$CMP" "$OUT")
approve merge-flag; merge
refused_unfiled "$before" "$CMP" "$OUT" && pass "$name" || fail "$name" "outside=[$(cat "$OUT/tl")] $(udiag)"

name='should refuse an archived timeline file that is a symlink'
fresh feat/demo/ship .oss/dev/completed/demo-2026-11-07
OUT="$T/out-link-file"; mkdir -p "$OUT"; printf '%s\n' '{"elsewhere":1}' > "$OUT/tl"
ln -s "$OUT/tl" "$P/.oss/dev/completed/demo-2026-11-07/timeline.ndjson"
CMP="$P/.oss/dev/completed"; before=$(snap "$CMP" "$OUT")
approve merge-flag; merge
refused_unfiled "$before" "$CMP" "$OUT" && pass "$name" || fail "$name" "outside=[$(cat "$OUT/tl")] $(udiag)"

name='should refuse an archived folder owned by someone else'
fresh feat/demo/ship .oss/dev/completed/demo-2026-11-07
CMP="$P/.oss/dev/completed"; before=$(snap "$CMP")
approve merge-flag
# someone else's folder, through `test -O` (the repo's other-user seam): exported, so the verb's own bash sees it
(export OSS_T_FOREIGN="/.oss/dev/completed/demo-2026-11-07"
    # shellcheck disable=SC2329 # run by the verb's bash, through export -f
    test() { if [[ "${1:-}" == -O && "${2%/}" == *"$OSS_T_FOREIGN" ]]; then return 1; fi; builtin test "$@"; }
    export -f test
    cd "$P" && run_capped 40 "$OV" timeline merge > /dev/null 2> "$T/err"); RC=$?; ERR=$(cat "$T/err")
refused_unfiled "$before" "$CMP" && pass "$name" || fail "$name" "$(udiag)"

name='should refuse a branch whose feature fails the name rule'
# git itself refuses a branch part that starts with "." (feat/.demo/ship cannot be made or read), so the name rule is
# shown with a name git allows and the rule does not: "+" is outside [A-Za-z0-9._-]
fresh feat/de+mo/ship .oss/dev/completed/de+mo-2026-11-07
[[ "$(cd "$P" && git symbolic-ref --short -q HEAD)" == feat/de+mo/ship ]] || echo "setup: branch feat/de+mo/ship not made"
CMP="$P/.oss/dev/completed"; before=$(snap "$CMP")
approve merge-flag; merge
refused_unfiled "$before" "$CMP" && pass "$name" || fail "$name" "$(udiag)"

name='should refuse a branch that is not <type>/<feature>/<phase>'
fresh main .oss/dev/completed/demo-2026-11-07
CMP="$P/.oss/dev/completed"; before=$(snap "$CMP")
approve merge-flag; merge
refused_unfiled "$before" "$CMP" && pass "$name" || fail "$name" "$(udiag)"

# --- B8: a decision recorded before the archive move still approves the merge after it ----------------------------
UUID=3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d
UNKNOWN=9d8c7b6a-5f4e-4d3c-a2b1-0f9e8d7c6b5a
# record <file>: G1's decision record holding the one decision $UUID, as oss-decision-record.sh writes it
record() { printf '%s\n' '{"v":1,"id":"'$UUID'","feature":"demo","question":"Ship it?","answer":"Yes"}' > "$1"; }
ARC=.oss/dev/completed/demo-2026-11-07
# archived_unknown: rc 1, one merge-unknown line for demo in the archived folder (B2-3), nothing in unfiled, no
# outbox entry (P-2)
archived_unknown() {
    local tl="$P/$ARC/timeline.ndjson"
    [[ $RC -eq 1 && $(lines "$tl") -eq 1 && "$(tail -n 1 "$tl" | jq -r '.kind + " " + .feature' 2>/dev/null)" == "merge-unknown demo" \
        && ! -e "$UNF" && -z "$(outbox)" ]]
}
adiag() { echo "rc=$RC archived=[$(cat "$P/$ARC/timeline.ndjson" 2>/dev/null)] $(udiag)"; }

name='should accept a decision id recorded before the archive move'
fresh feat/demo/ship "$ARC"; record "$P/$ARC/decisions.ndjson"
approve "decision:$UUID"; merge
ATL="$P/$ARC/timeline.ndjson"; last=$(tail -n 1 "$ATL" 2>/dev/null); nid=$(jq -r '.id' <<< "$last" 2>/dev/null)
if [[ $RC -eq 0 && $(lines "$ATL") -eq 1 && "$(jq -c '{kind, feature, approval}' <<< "$last" 2>/dev/null)" \
        == '{"kind":"merge","feature":"demo","approval":{"type":"decision","decisionId":"'$UUID'"}}' \
    && "$(outbox | jq -sc 'map({id, state})' 2>/dev/null)" == '[{"id":"'$nid'","state":"pending"}]' ]]; then
    pass "$name"
else
    fail "$name" "$(adiag)"
fi

name='should still refuse an unknown decision id after the archive move'
fresh feat/demo/ship "$ARC"; record "$P/$ARC/decisions.ndjson"
approve "decision:$UNKNOWN"; merge
archived_unknown && pass "$name" || fail "$name" "$(adiag)"

name='should refuse a decision record that is a symlink or has another hard link in the archived folder'
ok=1 bad=""
for how in symlink hardlink; do
    fresh feat/demo/ship "$ARC"
    OUT="$T/out-drec-$how"; mkdir -p "$OUT"; record "$OUT/d"
    if [[ $how == symlink ]]; then ln -s "$OUT/d" "$P/$ARC/decisions.ndjson"; else ln "$OUT/d" "$P/$ARC/decisions.ndjson"; fi
    approve "decision:$UUID"; merge
    archived_unknown || { ok=0; bad="$bad $how: $(adiag)"; }
done
[[ $ok -eq 1 ]] && pass "$name" || fail "$name" "$bad"

# --- FOLLOWUPS #197: no link on the way to decisions.ndjson, active or archived (B2-5) ------------------------------
# linked_refused <before snap>: the decision is not accepted (rc 1, the decision refusal on stderr), nothing is
# queued, and the outside folder the link points to is exactly as it was
linked_refused() {
    [[ $RC -eq 1 && "$ERR" == *"the decision is not in this feature's decision record"* && -z "$(outbox)" \
        && "$(snap "$OUT")" == "$1" ]]
}
ldiag() { echo "outside=[$(snap "$OUT")] $(udiag)"; }

name='should refuse a decision when .oss/dev/active is a link'
fresh feat/demo/ship; rmdir "$P/.oss/dev/active"
OUT="$T/out-active"; mkdir -p "$OUT/demo"; record "$OUT/demo/decisions.ndjson"; ln -s "$OUT" "$P/.oss/dev/active"
before=$(snap "$OUT"); approve "decision:$UUID"; merge
linked_refused "$before" && pass "$name" || fail "$name" "$(ldiag)"

name='should refuse a decision when .oss/dev/active/demo is a link'
fresh feat/demo/ship
OUT="$T/out-active-demo"; mkdir -p "$OUT"; record "$OUT/decisions.ndjson"; ln -s "$OUT" "$P/.oss/dev/active/demo"
before=$(snap "$OUT"); approve "decision:$UUID"; merge
linked_refused "$before" && pass "$name" || fail "$name" "$(ldiag)"

name='should refuse a decision when .oss/dev is a link (archived case)'
fresh feat/demo/ship; rm -rf "$P/.oss/dev"
OUT="$T/out-dev"; mkdir -p "$OUT/active" "$OUT/completed/demo-2026-11-07"
record "$OUT/completed/demo-2026-11-07/decisions.ndjson"; ln -s "$OUT" "$P/.oss/dev"
before=$(snap "$OUT"); approve "decision:$UUID"; merge
linked_refused "$before" && pass "$name" || fail "$name" "$(ldiag)"

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
