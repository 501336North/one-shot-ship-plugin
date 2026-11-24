#!/bin/bash
# The timeline gate writer records each gate line's hash in the person's private ledger (R-257 Task 8a, S2, P4).
#
# @behavior When OSS writes a gate line to a feature's timeline, the hash of that exact line is appended to
#           ~/.oss/ledger/<key>/gates/<feature> as {"sha256":"<hex>"}. A gate line added to timeline.ndjson by hand
#           (as the Write tool would) has no ledger hash, so the result assembler can tell a planted gate from a real
#           one. The ledger folder is 700 and the file 600; a linked ledger file is refused with one stderr line,
#           and the timeline line is still written with exit 0. Other kinds and unfiled lines add no ledger row.
# @business-rule D14 ledger contract (NOTES.md): gates/<feature> rows are {"sha256"}, the hex sha-256 of the gate
#           line without its newline; key = first 16 hex of the git blob id of "<toplevel>\n<absolute-git-dir>\n".
# Usage: /bin/bash hooks/__tests__/timeline-gate-ledger.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TLS="$ROOT/hooks/oss-timeline.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running timeline-gate-ledger tests..."

T=$(cd "$(mktemp -d /tmp/oss-timeline-gate-ledger.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.oss"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_PROJECT_DIR OSS_TL_SESSION
export CLAUDE_CODE_SESSION_ID=ledger-sess-1

# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
source "$ROOT/hooks/__tests__/lib/run-capped.sh"
API="$T/api-fake"; fake_api_install "$API"   # no config.json: nothing is sent
export PATH="$API/bin:$PATH"

sha() { if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi; }

# new_project <branch> [active folder...] -> P, TL (demo timeline), UN (unfiled), LG (the ledger gates/demo file)
new_project() {
    local b="$1" f top gd key; shift
    P=$(mktemp -d "$T/p.XXXXXX"); mkdir -p "$P/.oss/dev/active"
    for f in "$@"; do mkdir -p "$P/.oss/dev/active/$f"; done
    (cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -B "$b")
    export CLAUDE_PROJECT_DIR="$P"
    TL="$P/.oss/dev/active/demo/timeline.ndjson"; UN="$P/.oss/dev/timeline-unfiled.ndjson"
    top=$(cd "$P" && git rev-parse --show-toplevel); gd=$(cd "$P" && git rev-parse --absolute-git-dir)
    key=$(printf '%s\n%s\n' "$top" "$gd" | git hash-object --stdin | cut -c1-16)
    LD="$HOME/.oss/ledger/$key"; LG="$LD/gates/demo"
}
# gate -> RC, ERR: the gate verb as oss-value.sh timeline gate runs it
gate() { (cd "$P" && run_capped 20 "$TLS" gate 1 security pass '' '' full > /dev/null 2> "$T/err"); RC=$?; ERR=$(cat "$T/err"); }
command_line() { (cd "$P" && run_capped 20 "$TLS" command build start > /dev/null 2> "$T/err"); RC=$?; ERR=$(cat "$T/err"); }
rows() { local c=0; [[ -f "$1" ]] && c=$(wc -l < "$1" | tr -d ' '); echo "$c"; }
mode_of() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null; }

# --- a written gate line's hash lands in the ledger -----------------------------------------------------------------
new_project feat/demo/build demo
gate
want=$(tail -n 1 "$TL" 2>/dev/null | tr -d '\n' | sha | cut -d' ' -f1)
got=$(tail -n 1 "$LG" 2>/dev/null)
[[ $RC -eq 0 && -n "$want" && "$got" == "{\"sha256\":\"$want\"}" && $(rows "$LG") -eq 1 ]] \
    && pass "should record the sha-256 of the written gate line in ledger gates/<feature>" \
    || fail "should record the sha-256 of the written gate line in ledger gates/<feature>" "rc=$RC want=$want got=$got err=$ERR"

# --- the ledger file is 600 and its folders 700 ---------------------------------------------------------------------
[[ "$(mode_of "$LG")" == 600 && "$(mode_of "$LD/gates")" == 700 && "$(mode_of "$LD")" == 700 && "$(mode_of "$HOME/.oss/ledger")" == 700 ]] \
    && pass "should make the ledger file 600 and its folders 700" \
    || fail "should make the ledger file 600 and its folders 700" "file=$(mode_of "$LG") gates=$(mode_of "$LD/gates") key=$(mode_of "$LD")"

# --- a gate line appended by hand has no ledger hash ----------------------------------------------------------------
planted=$(tail -n 1 "$TL" | jq -c '.id = "11111111-1111-4111-8111-111111111111" | .round = 2')
printf '%s\n' "$planted" >> "$TL"
ph=$(printf '%s' "$planted" | sha | cut -d' ' -f1)
grep -q "$ph" "$LG" 2>/dev/null && r=found || r=absent
[[ $r == absent && $(rows "$LG") -eq 1 ]] \
    && pass "should have no ledger hash for a gate line appended to the timeline by hand" \
    || fail "should have no ledger hash for a gate line appended to the timeline by hand" "r=$r rows=$(rows "$LG")"

# --- a non-gate kind adds no ledger row -----------------------------------------------------------------------------
before=$(rows "$TL")
command_line
[[ $RC -eq 0 && $(rows "$TL") -eq $((before + 1)) && $(rows "$LG") -eq 1 ]] \
    && pass "should add no ledger row for a command line" \
    || fail "should add no ledger row for a command line" "rc=$RC tl=$(rows "$TL") ledger=$(rows "$LG") err=$ERR"

# --- a linked ledger file is refused; the timeline line is still written, exit 0 ------------------------------------
new_project feat/demo/build demo
mkdir -p -m 700 "$HOME/.oss/ledger" "$LD" "$LD/gates"
: > "$T/elsewhere"; ln -s "$T/elsewhere" "$LG"
gate
[[ $RC -eq 0 && $(rows "$TL") -eq 1 && ! -s "$T/elsewhere" && -n "$ERR" && $(printf '%s\n' "$ERR" | wc -l | tr -d ' ') -eq 1 ]] \
    && pass "should refuse a linked ledger file with one stderr line, still write the timeline line and exit 0" \
    || fail "should refuse a linked ledger file with one stderr line, still write the timeline line and exit 0" "rc=$RC tl=$(rows "$TL") target=$(wc -c < "$T/elsewhere") err=$ERR"

# --- a linked ledger folder is refused too --------------------------------------------------------------------------
new_project feat/demo/build demo
mkdir -p -m 700 "$HOME/.oss/ledger" "$LD" "$T/otherdir"; ln -s "$T/otherdir" "$LD/gates"
gate
[[ $RC -eq 0 && $(rows "$TL") -eq 1 && -z "$(ls -A "$T/otherdir")" && -n "$ERR" ]] \
    && pass "should refuse a linked ledger folder and still write the timeline line" \
    || fail "should refuse a linked ledger folder and still write the timeline line" "rc=$RC tl=$(rows "$TL") other=$(ls -A "$T/otherdir") err=$ERR"

# --- an unfiled gate line adds no ledger row ------------------------------------------------------------------------
new_project main
gate
n=$(find "$HOME/.oss/ledger/${LD##*/}" -type f 2>/dev/null | wc -l | tr -d ' ')
[[ $RC -eq 0 && $(rows "$UN") -eq 1 && $n -eq 0 ]] \
    && pass "should add no ledger row for an unfiled gate line" \
    || fail "should add no ledger row for an unfiled gate line" "rc=$RC unfiled=$(rows "$UN") ledger-files=$n err=$ERR"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
