#!/bin/bash
# Tests for build.md command documentation
#
# Usage: ./build-command.test.sh
#
# Tests:
# 1. build.md should document worktree isolation for --team mode
# 2. build.md should document graceful fallback for older CC versions
# 3. build.md should mention isolation: worktree in --team section

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_MD="$SCRIPT_DIR/../build.md"

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
# TEST 1: build.md should document worktree isolation for --team mode
#
# @behavior Users understand that --team mode uses isolated worktrees
# @acceptance-criteria build.md contains "worktree" in context of --team
# =============================================================================
test_worktree_documented() {
    local test_name="build.md should document worktree isolation for --team mode"
    ((TESTS_RUN++))

    if [[ ! -f "$BUILD_MD" ]]; then
        fail "$test_name" "file exists" "file not found: $BUILD_MD"
        return
    fi

    local worktree_mentions
    worktree_mentions=$(grep -ci "worktree" "$BUILD_MD" || true)

    if [[ "$worktree_mentions" -gt 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "worktree mentioned in docs" "0 mentions found"
    fi
}

# =============================================================================
# TEST 2: build.md should document graceful fallback for older CC versions
#
# @behavior Users on older CC know --team still works without worktrees
# @acceptance-criteria build.md mentions fallback behavior
# =============================================================================
test_fallback_documented() {
    local test_name="build.md should document graceful fallback for older CC"
    ((TESTS_RUN++))

    if [[ ! -f "$BUILD_MD" ]]; then
        fail "$test_name" "file exists" "file not found"
        return
    fi

    local fallback_mentions
    fallback_mentions=$(grep -ci "fallback\|older.*version\|v2\.1\.50" "$BUILD_MD" || true)

    if [[ "$fallback_mentions" -gt 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "fallback behavior documented" "0 mentions found"
    fi
}

# =============================================================================
# TEST 3: build.md should mention isolation: worktree parameter
#
# @behavior Documentation references the CC worktree isolation parameter
# @acceptance-criteria build.md contains "isolation: worktree" or "isolation.*worktree"
# =============================================================================
test_isolation_param_documented() {
    local test_name="build.md should mention isolation: worktree parameter"
    ((TESTS_RUN++))

    if [[ ! -f "$BUILD_MD" ]]; then
        fail "$test_name" "file exists" "file not found"
        return
    fi

    local isolation_mentions
    isolation_mentions=$(grep -ci "isolation.*worktree\|isolation: worktree" "$BUILD_MD" || true)

    if [[ "$isolation_mentions" -gt 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "isolation: worktree mentioned" "0 mentions found"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running build command documentation tests..."
echo "======================================="

test_worktree_documented
test_fallback_documented
test_isolation_param_documented

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
