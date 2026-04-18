#!/bin/bash
# Tests for /oss:xray plugin wrapper
#
# Usage: ./xray-wrapper.test.sh
#
# @behavior Plugin wrapper follows standard OSS pattern (auth, log, decrypt, execute)
# @business-rule No proprietary prompt content in plugin — all logic fetched from API
#
# Tests:
# 1. commands/xray.md should exist
# 2. should contain authentication check
# 3. should contain logging initialization
# 4. should contain status line update
# 5. should contain decrypt CLI instruction
# 6. should contain chain commands execution
# 7. should NOT contain proprietary prompt content

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
XRAY_WRAPPER="$SCRIPT_DIR/../xray.md"

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
# TEST 1: commands/xray.md should exist
# =============================================================================
test_file_exists() {
    local test_name="commands/xray.md should exist"
    ((TESTS_RUN++))

    if [[ -f "$XRAY_WRAPPER" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "file exists" "file not found: $XRAY_WRAPPER"
    fi
}

# =============================================================================
# TEST 2: should contain authentication check
# =============================================================================
test_auth_check() {
    local test_name="should contain authentication check"
    ((TESTS_RUN++))

    if [[ ! -f "$XRAY_WRAPPER" ]]; then
        fail "$test_name" "file exists" "file not found"
        return
    fi

    if grep -q 'config.json' "$XRAY_WRAPPER" && grep -q 'apiKey' "$XRAY_WRAPPER"; then
        pass "$test_name"
    else
        fail "$test_name" "contains config.json and apiKey" "missing auth check"
    fi
}

# =============================================================================
# TEST 3: should contain logging initialization
# =============================================================================
test_logging_init() {
    local test_name="should contain logging initialization"
    ((TESTS_RUN++))

    if [[ ! -f "$XRAY_WRAPPER" ]]; then
        fail "$test_name" "file exists" "file not found"
        return
    fi

    if grep -q 'oss-log.sh init xray' "$XRAY_WRAPPER"; then
        pass "$test_name"
    else
        fail "$test_name" "contains 'oss-log.sh init xray'" "missing logging init"
    fi
}

# =============================================================================
# TEST 4: should contain status line update
# =============================================================================
test_status_line() {
    local test_name="should contain status line update"
    ((TESTS_RUN++))

    if [[ ! -f "$XRAY_WRAPPER" ]]; then
        fail "$test_name" "file exists" "file not found"
        return
    fi

    if grep -q 'oss-notify.sh --workflow xray' "$XRAY_WRAPPER"; then
        pass "$test_name"
    else
        fail "$test_name" "contains 'oss-notify.sh --workflow xray'" "missing status line"
    fi
}

# =============================================================================
# TEST 5: should contain decrypt CLI instruction
# =============================================================================
test_decrypt_cli() {
    local test_name="should contain decrypt CLI instruction"
    ((TESTS_RUN++))

    if [[ ! -f "$XRAY_WRAPPER" ]]; then
        fail "$test_name" "file exists" "file not found"
        return
    fi

    if grep -q 'oss-decrypt --type workflows --name xray' "$XRAY_WRAPPER"; then
        pass "$test_name"
    else
        fail "$test_name" "contains 'oss-decrypt --type workflows --name xray'" "missing decrypt instruction"
    fi
}

# =============================================================================
# TEST 6: should contain chain commands execution
# =============================================================================
test_chain_commands() {
    local test_name="should contain chain commands execution"
    ((TESTS_RUN++))

    if [[ ! -f "$XRAY_WRAPPER" ]]; then
        fail "$test_name" "file exists" "file not found"
        return
    fi

    if grep -q 'CHAIN_COMMANDS' "$XRAY_WRAPPER"; then
        pass "$test_name"
    else
        fail "$test_name" "contains 'CHAIN_COMMANDS'" "missing chain commands section"
    fi
}

# =============================================================================
# TEST 7: should NOT contain proprietary prompt content
# =============================================================================
test_no_proprietary_content() {
    local test_name="should NOT contain proprietary prompt content"
    ((TESTS_RUN++))

    if [[ ! -f "$XRAY_WRAPPER" ]]; then
        fail "$test_name" "file exists" "file not found"
        return
    fi

    local has_leak=false

    if grep -q 'architecture-auditor' "$XRAY_WRAPPER"; then
        has_leak=true
    fi
    if grep -q 'security-auditor' "$XRAY_WRAPPER"; then
        has_leak=true
    fi
    if grep -q 'performance-engineer' "$XRAY_WRAPPER"; then
        has_leak=true
    fi
    if grep -q 'dependency-analyzer' "$XRAY_WRAPPER"; then
        has_leak=true
    fi

    if [[ "$has_leak" == "false" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no agent types in wrapper" "found proprietary agent names"
    fi
}

# =============================================================================
# RUN ALL TESTS
# =============================================================================
echo "=== /oss:xray Plugin Wrapper Tests ==="
echo ""

test_file_exists
test_auth_check
test_logging_init
test_status_line
test_decrypt_cli
test_chain_commands
test_no_proprietary_content

echo ""
echo "=== Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed ==="

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
