#!/bin/bash
# Tests for Iron Laws fetch removal from command files
#
# Usage: ./no-iron-laws-fetch.test.sh
#
# Tests:
# 1. No command file should reference fetch-iron-laws.sh
# 2. No command file should have "Step 3: Fetch IRON LAWS" section
# 3. All command files should have a note about CLAUDE.md Iron Laws

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMANDS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

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
# TEST 1: No command file should reference fetch-iron-laws.sh
#
# @behavior Command files don't call fetch-iron-laws
# @business-rule Iron Laws are loaded from CLAUDE.md, not per-command
# =============================================================================
test_no_fetch_iron_laws_reference() {
    local test_name="No command file should reference fetch-iron-laws.sh"
    ((TESTS_RUN++))

    local matches
    matches=$(grep -rl "fetch-iron-laws" "$COMMANDS_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')

    if [[ "$matches" == "0" ]]; then
        pass "$test_name"
    else
        local files
        files=$(grep -rl "fetch-iron-laws" "$COMMANDS_DIR"/*.md 2>/dev/null | xargs -I{} basename {} | head -5)
        fail "$test_name" "0 files referencing fetch-iron-laws" "$matches files (e.g. $files)"
    fi
}

# =============================================================================
# TEST 2: No command file should have "Fetch IRON LAWS" heading
#
# @behavior No Step 3 Iron Laws fetch section
# @business-rule Removed step should not appear in any form
# =============================================================================
test_no_fetch_iron_laws_heading() {
    local test_name="No command file should have 'Fetch IRON LAWS' heading"
    ((TESTS_RUN++))

    local matches
    matches=$(grep -rl "Fetch IRON LAWS" "$COMMANDS_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')

    if [[ "$matches" == "0" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "0 files with 'Fetch IRON LAWS' heading" "$matches files"
    fi
}

# =============================================================================
# TEST 3: All command files should have CLAUDE.md Iron Laws note
#
# @behavior Each command has note about session-start Iron Laws
# @business-rule Document that Iron Laws come from CLAUDE.md
# =============================================================================
test_claude_md_note_present() {
    local test_name="All command files should have CLAUDE.md Iron Laws note"
    ((TESTS_RUN++))

    local total_commands missing_note
    total_commands=$(ls "$COMMANDS_DIR"/*.md 2>/dev/null | grep -v __tests__ | wc -l | tr -d ' ')
    missing_note=$(grep -rL "Iron Laws.*CLAUDE.md\|CLAUDE.md.*Iron Laws\|IRON LAWS.*session start\|session start.*IRON LAWS" "$COMMANDS_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')

    if [[ "$missing_note" == "0" ]] && [[ "$total_commands" -gt "0" ]]; then
        pass "$test_name"
    else
        local files
        files=$(grep -rL "Iron Laws.*CLAUDE.md\|CLAUDE.md.*Iron Laws\|IRON LAWS.*session start\|session start.*IRON LAWS" "$COMMANDS_DIR"/*.md 2>/dev/null | xargs -I{} basename {} | head -5)
        fail "$test_name" "all $total_commands command files with CLAUDE.md note" "$missing_note missing (e.g. $files)"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running no-iron-laws-fetch tests..."
echo "======================================="

test_no_fetch_iron_laws_reference
test_no_fetch_iron_laws_heading
test_claude_md_note_present

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
