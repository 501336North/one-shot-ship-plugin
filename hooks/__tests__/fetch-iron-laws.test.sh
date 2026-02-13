#!/bin/bash
# Tests for fetch-iron-laws.sh hook
#
# Usage: ./fetch-iron-laws.test.sh
#
# Tests:
# 1. Exits 0 and outputs content when API returns plain markdown (non-raw mode)
# 2. Exits 1 when API returns non-200 status

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/../fetch-iron-laws.sh"

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
# TEST 1: Exits 0 when API returns plain markdown (non-raw mode)
#
# @behavior fetch-iron-laws outputs content when API returns plain markdown
# @acceptance-criteria Script exits 0, outputs the markdown body
# @boundary fetch-iron-laws.sh (system boundary)
# =============================================================================
test_plain_markdown_response() {
    local test_name="Exits 0 and outputs content when API returns plain markdown"
    ((TESTS_RUN++))

    TEST_HOME=$(mktemp -d)

    # Create config with API key
    mkdir -p "$TEST_HOME/.oss"
    echo '{"apiKey": "test-key-123"}' > "$TEST_HOME/.oss/config.json"

    # Create mock curl that returns plain markdown with 200 status code
    MOCK_BIN_DIR=$(mktemp -d)
    cat > "$MOCK_BIN_DIR/curl" << 'CURLEOF'
#!/bin/bash
# Mock curl: return plain markdown body + 200 status code
# curl uses -w "\n%{http_code}" so last line is the status
echo "# IRON LAWS"
echo ""
echo "## LAW 1: TDD"
echo ""
echo "200"
CURLEOF
    chmod +x "$MOCK_BIN_DIR/curl"

    # Run hook with mock curl and mock HOME
    local result exit_code=0
    result=$(HOME="$TEST_HOME" PATH="$MOCK_BIN_DIR:$PATH" "$HOOK_SCRIPT" 2>&1) || exit_code=$?

    rm -rf "$TEST_HOME" "$MOCK_BIN_DIR"

    if [[ $exit_code -eq 0 ]] && echo "$result" | grep -q "IRON LAWS"; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0 + output containing 'IRON LAWS'" "exit=$exit_code output: $result"
    fi
}

# =============================================================================
# TEST 2: Exits 1 when API returns non-200 status
#
# @behavior fetch-iron-laws reports error on API failure
# @acceptance-criteria Script exits 1 on 401 response
# @boundary fetch-iron-laws.sh (system boundary)
# =============================================================================
test_api_error_response() {
    local test_name="Exits 1 when API returns 401 status"
    ((TESTS_RUN++))

    TEST_HOME=$(mktemp -d)

    mkdir -p "$TEST_HOME/.oss"
    echo '{"apiKey": "bad-key"}' > "$TEST_HOME/.oss/config.json"

    MOCK_BIN_DIR=$(mktemp -d)
    cat > "$MOCK_BIN_DIR/curl" << 'CURLEOF'
#!/bin/bash
echo '{"error":"Unauthorized"}'
echo "401"
CURLEOF
    chmod +x "$MOCK_BIN_DIR/curl"

    local result exit_code=0
    result=$(HOME="$TEST_HOME" PATH="$MOCK_BIN_DIR:$PATH" "$HOOK_SCRIPT" 2>&1) || exit_code=$?

    rm -rf "$TEST_HOME" "$MOCK_BIN_DIR"

    if [[ $exit_code -ne 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit non-zero" "exit=$exit_code output: $result"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running fetch-iron-laws.sh tests..."
echo "======================================="

test_plain_markdown_response
test_api_error_response

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
