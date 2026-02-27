#!/bin/bash
# Tests for ideate CLAUDE.md template approach
#
# Usage: ./ideate-template.test.sh
#
# @behavior Fresh projects get a fully-formed CLAUDE.md with IRON LAWS from API
# @business-rule Ideate must NOT hardcode CLAUDE.md inline; must fetch from API
#
# Tests:
# 1. commands/ideate.md should NOT contain hardcoded 'cat > CLAUDE.md' pattern
# 2. commands/ideate.md should contain API template fetch instruction
# 3. skills/ideate.md should NOT contain hardcoded 'cat > CLAUDE.md' pattern
# 4. skills/ideate.md should contain API template fetch instruction

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMANDS_IDEATE="$SCRIPT_DIR/../ideate.md"
SKILLS_IDEATE="$SCRIPT_DIR/../../skills/ideate.md"

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
# TEST 1: commands/ideate.md should NOT contain hardcoded CLAUDE.md template
#
# @behavior Fresh projects don't get a minimal hardcoded CLAUDE.md
# @acceptance-criteria No 'cat > CLAUDE.md << EOF' pattern in commands/ideate.md
# =============================================================================
test_commands_no_hardcoded_template() {
    local test_name="commands/ideate.md should NOT contain hardcoded CLAUDE.md template"
    ((TESTS_RUN++))

    if [[ ! -f "$COMMANDS_IDEATE" ]]; then
        fail "$test_name" "file exists" "file not found: $COMMANDS_IDEATE"
        return
    fi

    if grep -q 'cat > CLAUDE.md' "$COMMANDS_IDEATE"; then
        fail "$test_name" "no hardcoded CLAUDE.md" "found 'cat > CLAUDE.md' pattern"
    else
        pass "$test_name"
    fi
}

# =============================================================================
# TEST 2: commands/ideate.md should contain API template fetch instruction
#
# @behavior The ideate command fetches CLAUDE.md template from API
# @acceptance-criteria commands/ideate.md references API template endpoint
# =============================================================================
test_commands_has_api_fetch() {
    local test_name="commands/ideate.md should contain API template fetch instruction"
    ((TESTS_RUN++))

    if [[ ! -f "$COMMANDS_IDEATE" ]]; then
        fail "$test_name" "file exists" "file not found: $COMMANDS_IDEATE"
        return
    fi

    if grep -q 'prompts/claude-md\|prompts/templates/claude-md\|template.*API\|fetch.*template' "$COMMANDS_IDEATE"; then
        pass "$test_name"
    else
        fail "$test_name" "API template fetch instruction" "no API template fetch found"
    fi
}

# =============================================================================
# TEST 3: skills/ideate.md should NOT contain hardcoded CLAUDE.md template
#
# @behavior Skills wrapper doesn't embed inline CLAUDE.md content
# @acceptance-criteria No 'cat > CLAUDE.md << EOF' pattern in skills/ideate.md
# =============================================================================
test_skills_no_hardcoded_template() {
    local test_name="skills/ideate.md should NOT contain hardcoded CLAUDE.md template"
    ((TESTS_RUN++))

    if [[ ! -f "$SKILLS_IDEATE" ]]; then
        fail "$test_name" "file exists" "file not found: $SKILLS_IDEATE"
        return
    fi

    if grep -q 'cat > CLAUDE.md' "$SKILLS_IDEATE"; then
        fail "$test_name" "no hardcoded CLAUDE.md" "found 'cat > CLAUDE.md' pattern"
    else
        pass "$test_name"
    fi
}

# =============================================================================
# TEST 4: skills/ideate.md should contain API template fetch instruction
#
# @behavior Skills wrapper directs to fetch template from API
# @acceptance-criteria skills/ideate.md references API template fetch
# =============================================================================
test_skills_has_api_fetch() {
    local test_name="skills/ideate.md should contain API template fetch instruction"
    ((TESTS_RUN++))

    if [[ ! -f "$SKILLS_IDEATE" ]]; then
        fail "$test_name" "file exists" "file not found: $SKILLS_IDEATE"
        return
    fi

    if grep -q 'prompts/claude-md\|prompts/templates/claude-md\|template.*API\|fetch.*template' "$SKILLS_IDEATE"; then
        pass "$test_name"
    else
        fail "$test_name" "API template fetch instruction" "no API template fetch found"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running ideate CLAUDE.md template tests..."
echo "======================================="

test_commands_no_hardcoded_template
test_commands_has_api_fetch
test_skills_no_hardcoded_template
test_skills_has_api_fetch

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
