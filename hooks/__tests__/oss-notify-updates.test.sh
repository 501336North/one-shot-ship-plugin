#!/bin/bash
# Tests for check-updates.sh wiring in oss-notify.sh
#
# @behavior Update check runs non-blocking on session start
# @business-rule Session start must not be delayed by update checks
#
# Usage: ./oss-notify-updates.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTIFY_SCRIPT="$SCRIPT_DIR/../oss-notify.sh"
CHECK_UPDATES_SCRIPT="$SCRIPT_DIR/../check-updates.sh"

# Test tracking
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((TESTS_PASSED++))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    echo "  Expected: $2"
    echo "  Got: $3"
    ((TESTS_FAILED++))
}

# =============================================================================
# TEST 1: oss-notify.sh references check-updates.sh in session handler
#
# @behavior Session start invokes check-updates.sh
# @acceptance-criteria oss-notify.sh contains call to check-updates.sh
# =============================================================================
test_notify_references_check_updates() {
    local test_name="Should call check-updates.sh on context_restored event"
    ((TESTS_RUN++))

    if [[ ! -f "$NOTIFY_SCRIPT" ]]; then
        fail "$test_name" "oss-notify.sh exists" "script not found"
        return
    fi

    if grep -q "check-updates.sh" "$NOTIFY_SCRIPT"; then
        pass "$test_name"
    else
        fail "$test_name" "oss-notify.sh references check-updates.sh" "no reference found"
    fi
}

# =============================================================================
# TEST 2: check-updates.sh invocation is non-blocking (background)
#
# @behavior Session start doesn't wait for update check to complete
# @acceptance-criteria check-updates.sh call uses & (background) or timeout
# =============================================================================
test_check_updates_is_nonblocking() {
    local test_name="Should not block session if check-updates.sh hangs"
    ((TESTS_RUN++))

    if [[ ! -f "$NOTIFY_SCRIPT" ]]; then
        fail "$test_name" "oss-notify.sh exists" "script not found"
        return
    fi

    # Check that check-updates.sh is called in background or with timeout
    if grep "check-updates.sh" "$NOTIFY_SCRIPT" | grep -qE '&|timeout|run_with_timeout'; then
        pass "$test_name"
    else
        local line
        line=$(grep "check-updates.sh" "$NOTIFY_SCRIPT")
        fail "$test_name" "check-updates.sh called with & or timeout" "line: '$line'"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running oss-notify update wiring tests..."
echo "======================================="

test_notify_references_check_updates
test_check_updates_is_nonblocking

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
