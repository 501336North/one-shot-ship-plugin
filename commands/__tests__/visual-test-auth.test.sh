#!/bin/bash
# Tests for /oss:visual-test Step 1 (Check Authentication)
#
# Usage: ./visual-test-auth.test.sh
#
# @behavior /oss:visual-test checks that an API key is configured without printing
#           the key into the session transcript.
# @business-rule The API key is a secret: the auth check answers "configured" or
#           "not found", never echoes the config line that holds the key (G10).
#
# Tests:
# 1. Step 1 has no `grep apiKey` (which prints the matching line, key included)
# 2. Step 1 uses the quiet check on ${OSS_CONFIG_DIR:-$HOME/.oss}/config.json
# 3. control: Step 1 exists and still tells the user what to do when no key is found

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="$SCRIPT_DIR/../visual-test.md"

QUIET_CHECK='grep -q '"'"'"apiKey"'"'"' "${OSS_CONFIG_DIR:-$HOME/.oss}/config.json" && echo "API key configured"'
PRINTING_CHECK='grep apiKey'
NO_KEY_TEXT='No API key found. Run: /oss:login'

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

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

# Step 1 text: from its heading up to the next "## " heading
step1() {
    awk '/^## Step 1: Check Authentication/{p=1; print; next} p && /^## /{exit} p' "$WRAPPER"
}

test_control_step1() {
    local test_name="control: Step 1 exists and keeps the no-key instruction"
    ((TESTS_RUN++))
    if step1 | grep -qF -- "$NO_KEY_TEXT"; then
        pass "$test_name"
    else
        fail "$test_name" "Step 1 with '$NO_KEY_TEXT'" "Step 1 or instruction missing"
    fi
}

test_no_printing_grep() {
    local test_name="Step 1 does not print the key (no '$PRINTING_CHECK')"
    ((TESTS_RUN++))
    if step1 | grep -qF -- "$PRINTING_CHECK"; then
        fail "$test_name" "no '$PRINTING_CHECK'" "found: $(step1 | grep -F -- "$PRINTING_CHECK" | head -1)"
    else
        pass "$test_name"
    fi
}

test_quiet_check() {
    local test_name="Step 1 checks the key quietly in \${OSS_CONFIG_DIR:-\$HOME/.oss}/config.json"
    ((TESTS_RUN++))
    if step1 | grep -qF -- "$QUIET_CHECK"; then
        pass "$test_name"
    else
        fail "$test_name" "literal $QUIET_CHECK" "quiet check not found"
    fi
}

echo "=== /oss:visual-test Auth Step Tests ==="
echo ""

test_control_step1
test_no_printing_grep
test_quiet_check

echo ""
echo "=== Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed ==="

[[ $TESTS_FAILED -eq 0 ]]
