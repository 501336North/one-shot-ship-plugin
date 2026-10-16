#!/bin/bash
# Tests for oss-session-start.sh Iron Laws sync integration
#
# Usage: ./session-start-iron-laws.test.sh
#
# Tests:
# 1. Session-start should call iron-laws-sync when API key exists
# 2. Session-start should skip sync when no API key
# 3. Session-start should copy sync script to ~/.oss/hooks/

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION_START_SCRIPT="$SCRIPT_DIR/../oss-session-start.sh"

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
# TEST 1: Session-start should call iron-laws-sync when API key exists
#
# @behavior Iron Laws sync is invoked during session initialization
# @business-rule Ensure Iron Laws are fresh at session start
# =============================================================================
test_calls_sync_with_api_key() {
    local test_name="Session-start should call iron-laws-sync when API key exists"
    ((TESTS_RUN++))

    # Check that oss-session-start.sh invokes oss-iron-laws-sync.sh (not just lists it)
    if grep -q "IRON_LAWS_SYNC_SCRIPT" "$SESSION_START_SCRIPT" 2>/dev/null; then
        # Verify invocation is AFTER the API key check
        local sync_line api_key_line
        sync_line=$(grep -n 'IRON_LAWS_SYNC_SCRIPT' "$SESSION_START_SCRIPT" | head -1 | cut -d: -f1)
        api_key_line=$(grep -n 'if \[\[ -z "$API_KEY"' "$SESSION_START_SCRIPT" | head -1 | cut -d: -f1)

        if [[ -n "$sync_line" ]] && [[ -n "$api_key_line" ]] && [[ "$sync_line" -gt "$api_key_line" ]]; then
            pass "$test_name"
        else
            fail "$test_name" "sync call after API key check" "sync_line=$sync_line api_key_line=$api_key_line"
        fi
    else
        fail "$test_name" "IRON_LAWS_SYNC_SCRIPT invocation in session-start" "not found"
    fi
}

# =============================================================================
# TEST 2: Session-start should skip sync when no API key
#
# @behavior No sync attempted without authentication
# @business-rule Don't make API calls without credentials
# =============================================================================
test_skips_sync_without_api_key() {
    local test_name="Session-start should skip sync when no API key"
    ((TESTS_RUN++))

    # Verify sync call is positioned after the API key exit guard
    # The script should exit before reaching sync if no API key
    local sync_line api_key_exit_line
    sync_line=$(grep -n 'IRON_LAWS_SYNC_SCRIPT' "$SESSION_START_SCRIPT" 2>/dev/null | head -1 | cut -d: -f1)
    # Find the "exit 0" that follows the empty API key check
    api_key_exit_line=$(grep -n 'exit 0' "$SESSION_START_SCRIPT" 2>/dev/null | head -2 | tail -1 | cut -d: -f1)

    if [[ -n "$sync_line" ]] && [[ -n "$api_key_exit_line" ]] && [[ "$sync_line" -gt "$api_key_exit_line" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "sync after API key exit guard" "sync_line=${sync_line:-missing} exit_line=${api_key_exit_line:-missing}"
    fi
}

# =============================================================================
# TEST 3: Session-start should copy sync script to ~/.oss/hooks/
#
# @behavior Sync script available for skills that run outside plugin context
# @business-rule Ensure hooks are accessible from ~/.oss/hooks/
# =============================================================================
test_copies_sync_to_oss_hooks() {
    local test_name="Session-start should copy sync script to ~/.oss/hooks/"
    ((TESTS_RUN++))

    # Behavioural: run session start against a clean HOME and check the script really lands there.
    # (A grep of HOOKS_TO_COPY passed for 2.0.51-2.0.83 while the script itself was never committed.)
    local tmp_home
    tmp_home=$(mktemp -d)
    HOME="$tmp_home" CLAUDE_PLUGIN_ROOT="$SCRIPT_DIR/../.." OSS_SKIP_HEALTH_CHECK=1 \
        bash "$SESSION_START_SCRIPT" >/dev/null 2>&1 </dev/null
    local copied="$tmp_home/.oss/hooks/oss-iron-laws-sync.sh"
    if [[ -x "$copied" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "executable ~/.oss/hooks/oss-iron-laws-sync.sh after session start" "exists=$([[ -f $copied ]] && echo y || echo n)"
    fi
    rm -rf "$tmp_home"
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running session-start Iron Laws integration tests..."
echo "======================================="

test_calls_sync_with_api_key
test_skips_sync_without_api_key
test_copies_sync_to_oss_hooks

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
