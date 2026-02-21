#!/bin/bash
# Tests for CLAUDE_CODE_SIMPLE detection in oss-session-start.sh
#
# Usage: ./simple-mode-check.test.sh
#
# Tests:
# 1. Should warn when CLAUDE_CODE_SIMPLE is set to true
# 2. Should warn when CLAUDE_CODE_SIMPLE is set to 1
# 3. Should not warn when CLAUDE_CODE_SIMPLE is unset
# 4. Should not warn when CLAUDE_CODE_SIMPLE is false or 0

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIMPLE_CHECK_SCRIPT="$SCRIPT_DIR/../oss-simple-mode-check.sh"

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
# TEST 1: Should warn when CLAUDE_CODE_SIMPLE is set to true
#
# @behavior Users running in simple mode see clear error about OSS incompatibility
# @acceptance-criteria Output contains warning about CLAUDE_CODE_SIMPLE
# =============================================================================
test_warn_simple_true() {
    local test_name="Should warn when CLAUDE_CODE_SIMPLE is set to true"
    ((TESTS_RUN++))

    if [[ ! -f "$SIMPLE_CHECK_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found: $SIMPLE_CHECK_SCRIPT"
        return
    fi

    local result
    result=$(CLAUDE_CODE_SIMPLE=true "$SIMPLE_CHECK_SCRIPT" 2>&1)

    if echo "$result" | grep -qi "CLAUDE_CODE_SIMPLE\|simple mode"; then
        pass "$test_name"
    else
        fail "$test_name" "warning about CLAUDE_CODE_SIMPLE" "output: '$result'"
    fi
}

# =============================================================================
# TEST 2: Should warn when CLAUDE_CODE_SIMPLE is set to 1
#
# @behavior Alternative truthy value also triggers warning
# @acceptance-criteria Output contains warning
# =============================================================================
test_warn_simple_one() {
    local test_name="Should warn when CLAUDE_CODE_SIMPLE is set to 1"
    ((TESTS_RUN++))

    if [[ ! -f "$SIMPLE_CHECK_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local result
    result=$(CLAUDE_CODE_SIMPLE=1 "$SIMPLE_CHECK_SCRIPT" 2>&1)

    if echo "$result" | grep -qi "CLAUDE_CODE_SIMPLE\|simple mode"; then
        pass "$test_name"
    else
        fail "$test_name" "warning about CLAUDE_CODE_SIMPLE" "output: '$result'"
    fi
}

# =============================================================================
# TEST 3: Should not warn when CLAUDE_CODE_SIMPLE is unset
#
# @behavior Normal users see no warning
# @acceptance-criteria No output when env var is unset
# =============================================================================
test_no_warn_unset() {
    local test_name="Should not warn when CLAUDE_CODE_SIMPLE is unset"
    ((TESTS_RUN++))

    if [[ ! -f "$SIMPLE_CHECK_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local result
    result=$(unset CLAUDE_CODE_SIMPLE; "$SIMPLE_CHECK_SCRIPT" 2>&1)

    if [[ -z "$result" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no output" "output: '$result'"
    fi
}

# =============================================================================
# TEST 4: Should not warn when CLAUDE_CODE_SIMPLE is false or 0
#
# @behavior Explicitly disabled simple mode is normal operation
# @acceptance-criteria No output when env var is false or 0
# =============================================================================
test_no_warn_false() {
    local test_name="Should not warn when CLAUDE_CODE_SIMPLE is false or 0"
    ((TESTS_RUN++))

    if [[ ! -f "$SIMPLE_CHECK_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local result_false result_zero
    result_false=$(CLAUDE_CODE_SIMPLE=false "$SIMPLE_CHECK_SCRIPT" 2>&1)
    result_zero=$(CLAUDE_CODE_SIMPLE=0 "$SIMPLE_CHECK_SCRIPT" 2>&1)

    if [[ -z "$result_false" && -z "$result_zero" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no output" "false='$result_false' zero='$result_zero'"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running simple mode check tests..."
echo "======================================="

test_warn_simple_true
test_warn_simple_one
test_no_warn_unset
test_no_warn_false

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
