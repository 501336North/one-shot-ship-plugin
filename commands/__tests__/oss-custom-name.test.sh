#!/bin/bash
# Tests for /oss:oss-custom command-name validation
#
# Usage: ./oss-custom-name.test.sh
#
# @behavior /oss:oss-custom refuses a custom command name that is not a plain
#           identifier before any shell command or oss-decrypt call uses it.
# @business-rule A team command name reaches shell commands and the decrypt CLI;
#           after stripping `team:`, only names matching ^[a-z0-9-]{1,128}$ (the
#           API's team-name rule, the same literal as isSafeTeamCommandName in
#           watcher/src/utils/safe-chain-name.ts) may be used; anything else stops
#           the command with a report and runs nothing.
#
# Tests:
# 1. oss-custom.md states the name pattern
# 2. oss-custom.md says to stop and never run anything with an invalid name
# 3. the rule appears before the first line that uses the name (control: such a line exists)
# 4. the pattern is the same literal as the chain-trigger team-name helper
# 5. the old, narrower /oss: name rule is not stated (no contradictory second rule)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="$SCRIPT_DIR/../oss-custom.md"
HELPER="$SCRIPT_DIR/../../watcher/src/utils/safe-chain-name.ts"

NAME_PATTERN='^[a-z0-9-]{1,128}$'
OLD_NAME_PATTERN='^[a-z][a-z0-9-]{0,40}$'
STOP_RULE='stop and report it; never run any command with it'

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

# =============================================================================
# TEST 1: states the name pattern
# =============================================================================
test_pattern_stated() {
    local test_name="oss-custom.md requires the name to match $NAME_PATTERN"
    ((TESTS_RUN++))
    if grep -qF -- "$NAME_PATTERN" "$WRAPPER"; then
        pass "$test_name"
    else
        fail "$test_name" "literal $NAME_PATTERN" "pattern not found"
    fi
}

# =============================================================================
# TEST 2: invalid name stops the command
# =============================================================================
test_stop_rule() {
    local test_name="oss-custom.md stops on an invalid name and runs nothing"
    ((TESTS_RUN++))
    if grep -qF -- "$STOP_RULE" "$WRAPPER"; then
        pass "$test_name"
    else
        fail "$test_name" "literal '$STOP_RULE'" "stop rule not found"
    fi
}

# =============================================================================
# TEST 3: rule comes before the first use of the name
# =============================================================================
test_rule_before_first_use() {
    local test_name="name validation appears before the first command that uses the name"
    ((TESTS_RUN++))
    local rule_line first_use
    rule_line=$(grep -nF -- "$NAME_PATTERN" "$WRAPPER" | head -1 | cut -d: -f1)
    first_use=$(grep -nF -e '{COMMAND_NAME}' -e '$COMMAND_NAME' -e '${1#team:}' "$WRAPPER" | head -1 | cut -d: -f1)
    if [[ -z "$first_use" ]]; then
        fail "$test_name" "a line that uses the name (control)" "no use of the name found"
    elif [[ -z "$rule_line" ]]; then
        fail "$test_name" "rule before line $first_use" "rule not found"
    elif (( rule_line < first_use )); then
        pass "$test_name (rule line $rule_line < first use line $first_use)"
    else
        fail "$test_name" "rule before line $first_use" "rule at line $rule_line"
    fi
}

# =============================================================================
# TEST 4: same literal as the helper chain-trigger uses for team names
# =============================================================================
test_same_as_helper() {
    local test_name="the pattern is the isSafeTeamCommandName regex in safe-chain-name.ts"
    ((TESTS_RUN++))
    if grep -A3 -F -- 'function isSafeTeamCommandName' "$HELPER" | grep -qF -- "/$NAME_PATTERN/"; then
        pass "$test_name"
    else
        fail "$test_name" "/$NAME_PATTERN/ in isSafeTeamCommandName" "helper regex differs or not found"
    fi
}

# =============================================================================
# TEST 5: no contradictory narrower rule
# =============================================================================
test_no_old_rule() {
    local test_name="oss-custom.md does not state the narrower /oss: rule $OLD_NAME_PATTERN"
    ((TESTS_RUN++))
    if grep -qF -- "$OLD_NAME_PATTERN" "$WRAPPER"; then
        fail "$test_name" "no $OLD_NAME_PATTERN" "old rule still present"
    else
        pass "$test_name"
    fi
}

echo "=== /oss:oss-custom Name Validation Tests ==="
echo ""

test_pattern_stated
test_stop_rule
test_rule_before_first_use
test_same_as_helper
test_no_old_rule

echo ""
echo "=== Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed ==="

[[ $TESTS_FAILED -eq 0 ]]
