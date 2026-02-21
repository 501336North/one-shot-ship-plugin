#!/bin/bash
# Tests for agent frontmatter configuration
#
# Usage: ./agent-frontmatter.test.sh
#
# Tests:
# 1. code-reviewer should NOT have background: true (quality gate must block)
# 2. performance-auditor should NOT have background: true (quality gate must block)
# 3. security-auditor should NOT have background: true (quality gate must block)
# 4. debugger should NOT have background: true (interactive agent)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_DIR="$SCRIPT_DIR/.."

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

# Helper: Extract YAML frontmatter value from a markdown file
# Usage: get_frontmatter_value <file> <key>
# Returns the value or empty string if not found
get_frontmatter_value() {
    local file="$1"
    local key="$2"
    # Extract content between --- markers, then find the key
    sed -n '/^---$/,/^---$/p' "$file" | grep "^${key}:" | sed "s/^${key}: *//" | tr -d '\r'
}

# =============================================================================
# TEST 1: code-reviewer should NOT have background: true (quality gate)
#
# @behavior Quality gate agents must block to enforce gates
# @acceptance-criteria code-reviewer.md frontmatter does NOT have background: true
# =============================================================================
test_code_reviewer_not_background() {
    local test_name="code-reviewer should NOT have background: true (quality gate)"
    ((TESTS_RUN++))

    local file="$AGENTS_DIR/code-reviewer.md"
    if [[ ! -f "$file" ]]; then
        fail "$test_name" "file exists" "file not found: $file"
        return
    fi

    local value
    value=$(get_frontmatter_value "$file" "background")

    if [[ "$value" != "true" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "background NOT true" "background: '$value'"
    fi
}

# =============================================================================
# TEST 2: performance-auditor should NOT have background: true (quality gate)
#
# @behavior Quality gate agents must block to enforce gates
# @acceptance-criteria performance-auditor.md frontmatter does NOT have background: true
# =============================================================================
test_performance_auditor_not_background() {
    local test_name="performance-auditor should NOT have background: true (quality gate)"
    ((TESTS_RUN++))

    local file="$AGENTS_DIR/performance-auditor.md"
    if [[ ! -f "$file" ]]; then
        fail "$test_name" "file exists" "file not found: $file"
        return
    fi

    local value
    value=$(get_frontmatter_value "$file" "background")

    if [[ "$value" != "true" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "background NOT true" "background: '$value'"
    fi
}

# =============================================================================
# TEST 3: security-auditor should NOT have background: true (quality gate)
#
# @behavior Quality gate agents must block to enforce gates
# @acceptance-criteria security-auditor.md frontmatter does NOT have background: true
# =============================================================================
test_security_auditor_not_background() {
    local test_name="security-auditor should NOT have background: true (quality gate)"
    ((TESTS_RUN++))

    local file="$AGENTS_DIR/security-auditor.md"
    if [[ ! -f "$file" ]]; then
        fail "$test_name" "file exists" "file not found: $file"
        return
    fi

    local value
    value=$(get_frontmatter_value "$file" "background")

    if [[ "$value" != "true" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "background NOT true" "background: '$value'"
    fi
}

# =============================================================================
# TEST 4: debugger should NOT have background: true (interactive agent)
#
# @behavior Interactive agents must run in foreground for user interaction
# @acceptance-criteria debugger.md frontmatter does NOT have background: true
# =============================================================================
test_debugger_not_background() {
    local test_name="debugger should NOT have background: true (interactive agent)"
    ((TESTS_RUN++))

    local file="$AGENTS_DIR/debugger.md"
    if [[ ! -f "$file" ]]; then
        fail "$test_name" "file exists" "file not found: $file"
        return
    fi

    local value
    value=$(get_frontmatter_value "$file" "background")

    if [[ "$value" != "true" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "background NOT true" "background: '$value'"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running agent frontmatter tests..."
echo "======================================="

test_code_reviewer_not_background
test_performance_auditor_not_background
test_security_auditor_not_background
test_debugger_not_background

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
