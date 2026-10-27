#!/bin/bash
# Tests for code-simplifier agent wrapper (ONE-34)
#
# Verifies:
# 1. code-simplifier.md exists in agents directory
# 2. Fetches its OWN prompt (agents/code-simplifier) through the verified decrypt CLI, installed first
#    (release channels T8 / ADR-005: oss-decrypt follows apiUrl and checks the signed manifest; no WebFetch)
# 3. Checks auth (oss-value.sh keycheck, which never prints the key) before fetching
# 4. Contains error handling (401, 403, 500)
#
# Usage: ./code-simplifier.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_DIR="$SCRIPT_DIR/.."
FILE="$AGENTS_DIR/code-simplifier.md"

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
# TEST 1: code-simplifier.md exists
# =============================================================================
test_file_exists() {
    local test_name="code-simplifier.md should exist"
    ((TESTS_RUN++))

    if [[ -f "$FILE" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "file exists" "file not found: $FILE"
    fi
}

# =============================================================================
# TEST 2: Fetches its own prompt, verified (oss-decrypt after the install step)
# =============================================================================
FETCH_LINE='~/.oss/bin/oss-decrypt --type agents --name code-simplifier'
INSTALL_RE='^~/\.oss/hooks/ensure-decrypt-cli\.sh '
KEYCHECK_LINE='~/.oss/hooks/oss-value.sh keycheck'

line_of() { grep -n "$@" "$FILE" 2>/dev/null | head -1 | cut -d: -f1; }

test_api_fetch_url() {
    local test_name="should fetch its own prompt through oss-decrypt, after installing the CLI"
    ((TESTS_RUN++))

    local fetch install webfetch
    fetch=$(line_of -xF "$FETCH_LINE")
    install=$(line_of -E "$INSTALL_RE")
    webfetch=$(grep -c 'WebFetch' "$FILE" 2>/dev/null)

    if [[ -n "$fetch" && -n "$install" && "$install" -lt "$fetch" && "$webfetch" -eq 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "ensure-decrypt-cli.sh, then the line: $FETCH_LINE; no WebFetch" \
            "install line=${install:-none} fetch line=${fetch:-none} WebFetch mentions=$webfetch"
    fi
}

# =============================================================================
# TEST 3: Checks auth before fetching, without printing the key
# =============================================================================
test_auth_check() {
    local test_name="should check auth (keycheck) before fetching, never printing the key"
    ((TESTS_RUN++))

    local check fetch printing
    check=$(line_of -xF "$KEYCHECK_LINE")
    fetch=$(line_of -xF "$FETCH_LINE")
    printing=$(grep -cE 'grep[^|]*apiKey' "$FILE" 2>/dev/null)

    if [[ -n "$check" && -n "$fetch" && "$check" -lt "$fetch" && "$printing" -eq 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "the line: $KEYCHECK_LINE, before the fetch; no grep of apiKey" \
            "keycheck line=${check:-none} fetch line=${fetch:-none} apiKey greps=$printing"
    fi
}

# =============================================================================
# TEST 4: Contains error handling
# =============================================================================
test_error_handling() {
    local test_name="should contain error handling (401, 403, 500)"
    ((TESTS_RUN++))

    local has_401 has_403 has_500
    has_401=$(grep -c "401" "$FILE" 2>/dev/null || echo 0)
    has_403=$(grep -c "403" "$FILE" 2>/dev/null || echo 0)
    has_500=$(grep -c "500" "$FILE" 2>/dev/null || echo 0)

    if [[ "$has_401" -gt 0 && "$has_403" -gt 0 && "$has_500" -gt 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "contains 401, 403, 500" "401=$has_401 403=$has_403 500=$has_500"
    fi
}

# =============================================================================
# TEST 5: No proprietary content leaked (IP protection)
# =============================================================================
test_no_ip_leakage() {
    local test_name="should NOT contain proprietary prompt content (IP protection)"
    ((TESTS_RUN++))

    local leaked=""
    grep -q "Refinement Standards" "$FILE" 2>/dev/null && leaked="$leaked Refinement"
    grep -q "Preserve Functionality" "$FILE" 2>/dev/null && leaked="$leaked Preserve"
    grep -q "nested ternary" "$FILE" 2>/dev/null && leaked="$leaked ternary"

    if [[ -z "$leaked" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no proprietary content" "found:$leaked"
    fi
}

# =============================================================================
# TEST 6: Contains model routing frontmatter
# =============================================================================
test_model_routing() {
    local test_name="should contain model_routing frontmatter"
    ((TESTS_RUN++))

    if grep -q "model_routing: true" "$FILE" 2>/dev/null; then
        pass "$test_name"
    else
        fail "$test_name" "contains model_routing: true" "not found"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running code-simplifier agent tests (ONE-34)..."
echo "=================================================="

test_file_exists
test_api_fetch_url
test_auth_check
test_error_handling
test_no_ip_leakage
test_model_routing

echo ""
echo "=================================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
