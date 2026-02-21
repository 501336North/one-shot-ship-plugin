#!/bin/bash
# Tests for settings.json plugin configuration
#
# Usage: ./__tests__/settings-json.test.sh
#
# Tests:
# 1. settings.json exists and is valid JSON
# 2. Should pre-approve git commands
# 3. Should pre-approve vitest/npm/node commands
# 4. Should NOT pre-approve destructive commands

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS_FILE="$SCRIPT_DIR/../settings.json"

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
# TEST 1: settings.json exists and is valid JSON with permissions
#
# @behavior Plugin ships with pre-configured permissions to reduce prompts
# @acceptance-criteria settings.json is valid JSON with permissions array
# =============================================================================
test_valid_json_structure() {
    local test_name="settings.json exists and is valid JSON with permissions"
    ((TESTS_RUN++))

    if [[ ! -f "$SETTINGS_FILE" ]]; then
        fail "$test_name" "file exists" "file not found: $SETTINGS_FILE"
        return
    fi

    # Check valid JSON
    if ! jq empty "$SETTINGS_FILE" 2>/dev/null; then
        fail "$test_name" "valid JSON" "invalid JSON"
        return
    fi

    # Check permissions array exists
    local has_permissions
    has_permissions=$(jq 'has("permissions")' "$SETTINGS_FILE" 2>/dev/null)

    if [[ "$has_permissions" == "true" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "has permissions key" "missing permissions key"
    fi
}

# =============================================================================
# TEST 2: Should pre-approve git commands
#
# @behavior Users can run git status, add, commit, etc. without being prompted
# @acceptance-criteria At least one git-related pattern in permissions
# =============================================================================
test_git_commands_approved() {
    local test_name="Should pre-approve git commands"
    ((TESTS_RUN++))

    if [[ ! -f "$SETTINGS_FILE" ]]; then
        fail "$test_name" "file exists" "file not found"
        return
    fi

    local git_patterns
    git_patterns=$(jq -r '.permissions[]' "$SETTINGS_FILE" 2>/dev/null | grep -c "git" || echo "0")

    if [[ "$git_patterns" -gt 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "git patterns present" "no git patterns found"
    fi
}

# =============================================================================
# TEST 3: Should pre-approve vitest/npm/node commands
#
# @behavior Users can run test and build tools without being prompted
# @acceptance-criteria vitest, npm, and node patterns in permissions
# =============================================================================
test_build_tools_approved() {
    local test_name="Should pre-approve vitest/npm/node commands"
    ((TESTS_RUN++))

    if [[ ! -f "$SETTINGS_FILE" ]]; then
        fail "$test_name" "file exists" "file not found"
        return
    fi

    local all_perms
    all_perms=$(jq -r '.permissions[]' "$SETTINGS_FILE" 2>/dev/null)

    local has_vitest has_npm has_node
    has_vitest=$(echo "$all_perms" | grep -c "vitest" || echo "0")
    has_npm=$(echo "$all_perms" | grep -c "npm" || echo "0")
    has_node=$(echo "$all_perms" | grep -c "node" || echo "0")

    if [[ "$has_vitest" -gt 0 && "$has_npm" -gt 0 && "$has_node" -gt 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "vitest, npm, and node patterns" "vitest=$has_vitest npm=$has_npm node=$has_node"
    fi
}

# =============================================================================
# TEST 4: Should NOT pre-approve destructive commands
#
# @behavior Dangerous operations still require user confirmation
# @acceptance-criteria No patterns for rm -rf, git push --force, git reset --hard
# =============================================================================
test_no_destructive_commands() {
    local test_name="Should NOT pre-approve destructive commands"
    ((TESTS_RUN++))

    if [[ ! -f "$SETTINGS_FILE" ]]; then
        fail "$test_name" "file exists" "file not found"
        return
    fi

    local all_perms
    all_perms=$(jq -r '.permissions[]' "$SETTINGS_FILE" 2>/dev/null)

    local has_rm_rf has_force_push has_hard_reset
    has_rm_rf=$(echo "$all_perms" | grep -c "rm -rf" || true)
    has_force_push=$(echo "$all_perms" | grep -c -- "--force\|push -f" || true)
    has_hard_reset=$(echo "$all_perms" | grep -c "reset --hard" || true)

    if [[ "$has_rm_rf" -eq 0 && "$has_force_push" -eq 0 && "$has_hard_reset" -eq 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no destructive patterns" "rm_rf=$has_rm_rf force_push=$has_force_push hard_reset=$has_hard_reset"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running settings.json tests..."
echo "======================================="

test_valid_json_structure
test_git_commands_approved
test_build_tools_approved
test_no_destructive_commands

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
