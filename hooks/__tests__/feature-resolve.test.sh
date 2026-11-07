#!/bin/bash
# One rule finds the feature folder a hook files a line under (radical-observability G2 Task 2).
#
# @behavior Given a product repo's branch and its .oss/dev/active folders, the decision record (G1) and the
#           timeline (G2) both file under the same feature folder, or both under "unfiled": a
#           <type>/<feature>/<phase> branch names the feature when that folder is active; any other branch
#           takes the only active folder; a name that is not a plain folder name is never used.
# @business-rule ADR-009 (the IRON LAW #4 branch convention). One copy of the rule, oss_resolve_feature in
#           hooks/oss-safe-path.sh, so G1 and G2 can never drift apart (provenance). A linked active folder
#           still resolves to its name: the write is then refused by oss_safe_target (AC-G2-001.5), never
#           quietly filed as unfiled.
# Usage: /bin/bash hooks/__tests__/feature-resolve.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SAFE="$ROOT/hooks/oss-safe-path.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

T=$(cd "$(mktemp -d /tmp/oss-feature-resolve.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.oss"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_CODE_SESSION_ID CLAUDE_PROJECT_DIR

# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
source "$ROOT/hooks/__tests__/lib/run-capped.sh"   # the one time cap a test may use (T49)
API="$T/api-fake"; fake_api_install "$API"   # any curl the helper made would reach only the fake
export PATH="$API/bin:$PATH"

# new_project <branch> [active folder...] -> Q, a product repo on <branch> with those active folders
new_project() {
    local b="$1" f; shift
    Q=$(mktemp -d "$T/p.XXXXXX"); mkdir -p "$Q/.oss/dev/active"
    for f in "$@"; do mkdir -p "$Q/.oss/dev/active/$f"; done
    (cd "$Q" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -B "$b")
}
# resolve -> GOT, the feature oss_resolve_feature finds for $Q ("" = unfiled), and RC
resolve() {
    GOT=$(run_capped 20 /bin/bash -c 'source "$1" || exit 99; oss_resolve_feature "$2"; printf "%s" "${_OSS_FEATURE-UNSET}"' _ "$SAFE" "$Q" 2>"$T/err")
    RC=$?
}
# expect <name> <want>: want "" means unfiled
expect() {
    resolve
    [[ $RC -eq 0 && "$GOT" == "$2" ]] && pass "$1" || fail "$1" "rc=$RC got='$GOT' want='$2' stderr=$(cat "$T/err")"
}

new_project feat/demo/build demo
expect 'should file under demo on feat/demo/build when that folder is active' demo

new_project feat/missing/build demo
expect 'should give unfiled on feat/missing/build, not fall back to the only active folder' ''

new_project main demo
expect 'should take the only active folder on a branch that names no feature' demo

new_project main demo other
expect 'should give unfiled on such a branch when two folders are active' ''

new_project main
expect 'should give unfiled on such a branch when no folder is active' ''

new_project feat/de+mo/build de+mo
expect 'should give unfiled when the branch names a folder that fails the name rule' ''

new_project feat/demo/build
O=$(mktemp -d "$T/outside.XXXXXX"); ln -s "$O" "$Q/.oss/dev/active/demo"
expect 'should still resolve a symlinked active folder to its name, so the write is refused later' demo

new_project main
O=$(mktemp -d "$T/outside.XXXXXX"); ln -s "$O" "$Q/.oss/dev/active/demo"
expect 'should still resolve the only active folder to its name when it is a symlink' demo

# HEAD pointing at a ref that is not a branch (a tag, a remote) names no feature: the same fallback as a detached HEAD,
# the only active folder or unfiled, never the ref's type or its second part (ship gate S1, F3)
# head_at <ref>: HEAD as a symbolic ref to <ref>, made to exist at the current commit
# (a setup that did not take fails the case)
head_at() { (cd "$Q" && git update-ref "$1" HEAD && git symbolic-ref HEAD "$1") && [[ "$(cd "$Q" && git symbolic-ref -q HEAD)" == "$1" ]]; }
name='should give unfiled when HEAD points at a remote ref, never its type or feature part'
new_project main feat evil
if head_at refs/remotes/origin/feat/evil/ship; then expect "$name" ''; else fail "$name" "setup: HEAD not at the remote ref"; fi
name='should take the only active folder when HEAD points at a tag, as on a detached HEAD'
new_project main demo
if head_at refs/tags/feat/evil/ship; then expect "$name" demo; else fail "$name" "setup: HEAD not at the tag"; fi

# Sourced into a shell with failglob on (G1 and G2 both source this file into shells they do not own), the fallback
# for a branch that names no feature must still finish: the caller goes on, and gets the only active folder or
# unfiled (ship gate round 2, pen-test)
# resolve_failglob -> GOT: what the caller prints after the call, MARK[<feature>] when it went on, and whether its
# failglob is still on (the call leaves the caller's options as they were)
resolve_failglob() {
    GOT=$(run_capped 20 /bin/bash -c 'shopt -s failglob; source "$1" || exit 99; oss_resolve_feature "$2"; printf "MARK[%s]" "${_OSS_FEATURE-UNSET}"; shopt -q failglob && printf " failglob"' \
        _ "$SAFE" "$Q" 2>"$T/err")
    RC=$?
}
name='should let the caller go on with unfiled when failglob is on and no folder is active'
new_project main
resolve_failglob
[[ $RC -eq 0 && "$GOT" == 'MARK[] failglob' ]] && pass "$name" || fail "$name" "rc=$RC got='$GOT' stderr=$(cat "$T/err")"
name='should still take the only active folder when failglob is on'
new_project main demo
resolve_failglob
[[ $RC -eq 0 && "$GOT" == 'MARK[demo] failglob' ]] && pass "$name" || fail "$name" "rc=$RC got='$GOT' stderr=$(cat "$T/err")"

echo "$RUN run, $FAILED failed"; [[ $FAILED -eq 0 ]]
