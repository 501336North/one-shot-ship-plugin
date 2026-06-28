#!/bin/bash
# Tests that build-oss-launch.yml pins every action to a full commit SHA (supply-chain hardening).
#
# @behavior Every `uses:` is pinned to a 40-hex commit SHA, not a mutable tag. A retagged action
#   (esp. the write-capable release job) cannot substitute artifacts.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WF="$SCRIPT_DIR/../build-oss-launch.yml"

PASS=0; FAIL=0
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((PASS++)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; echo "  $2"; ((FAIL++)); }

# No `uses: …@vN` (mutable tag) may remain — must be @<40-hex>.
bare="$(grep -nE 'uses:[[:space:]]*[^@]+@v[0-9]' "$WF" || true)"
if [[ -z "$bare" ]]; then pass "no bare @vN tags on any uses:"; else fail "found mutable tag pins" "$bare"; fi

# Every uses: line is pinned to a 40-hex SHA.
unpinned="$(grep -nE 'uses:' "$WF" | grep -vE 'uses:[[:space:]]*[^@]+@[0-9a-f]{40}' || true)"
if [[ -z "$unpinned" ]]; then pass "every uses: pinned to a 40-hex SHA"; else fail "unpinned uses:" "$unpinned"; fi

# The write-capable release action is specifically pinned.
if grep -qE 'softprops/action-gh-release@[0-9a-f]{40}' "$WF"; then pass "action-gh-release SHA-pinned"; else fail "action-gh-release not SHA-pinned" "$(grep -n action-gh-release "$WF")"; fi

echo "-----"; echo "passed: $PASS, failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
