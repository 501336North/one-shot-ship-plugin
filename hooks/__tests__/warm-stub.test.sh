#!/bin/bash
# hooks/__tests__/lib/warm-stub.sh: warm_stub writes a fake command and runs it once, up front.
#
# @behavior `warm_stub <file> <body>` returns a stub that has already been exec'd once, so the
#           first-exec security scan (macOS: 0.3-60 s per new file) is paid before any timed check.
# @business-rule Hook tests must not fail because of how long the OS takes to vet a new file (T7).
#           The warm-up run must not perform the stub's real work, and later runs must.
#
# Usage: ./hooks/__tests__/warm-stub.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

# shellcheck source=lib/warm-stub.sh
source "$ROOT/hooks/__tests__/lib/warm-stub.sh"

T=$(cd "$(mktemp -d /tmp/warm-stub.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT

# --- should run a new stub once before handing it over ---------------------------------------
STUB="$T/bin/fake-tool"
SIDE="$T/ran"
WARM_SEEN=""
on_warm() { [ -f "$1" ] && WARM_SEEN="${WARM_SEEN}x"; }

warm_stub "$STUB" "echo body > \"$SIDE\"" on_warm; RC=$?
[[ "$RC" == 0 && "$WARM_SEEN" == x ]] && pass "the warm-up ran the stub once and left its marker" \
    || fail "the warm-up ran the stub once and left its marker" "rc=$RC seen='$WARM_SEEN'"
[[ ! -e "$SIDE" ]] && pass "the warm-up did not do the stub's real work" \
    || fail "the warm-up did not do the stub's real work" "$SIDE exists"

"$STUB"
[[ "$(cat "$SIDE" 2>/dev/null)" == body ]] && pass "a normal run does the stub's real work" \
    || fail "a normal run does the stub's real work" "got '$(cat "$SIDE" 2>&1)'"

echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
