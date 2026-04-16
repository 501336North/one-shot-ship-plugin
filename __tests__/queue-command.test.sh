#!/bin/bash
# Tests for queue command wrapper
#
# Usage: ./__tests__/queue-command.test.sh
#
# Tests:
# 1. queue.md exists and is valid
# 2. Should fetch queue prompt via oss-decrypt
# 3. Should pass subcommand arguments to prompt

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUEUE_FILE="$SCRIPT_DIR/../commands/queue.md"

# Test tracking
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
    ((TESTS_FAILED++))
}

# Test 1: queue.md exists
((TESTS_RUN++))
if [[ -f "$QUEUE_FILE" ]]; then
    pass "queue.md exists"
else
    fail "queue.md does not exist"
fi

# Test 2: Should fetch queue prompt via oss-decrypt
((TESTS_RUN++))
if grep -q "oss-decrypt.*--type workflows.*--name queue" "$QUEUE_FILE"; then
    pass "queue.md fetches prompt via oss-decrypt"
else
    fail "queue.md should contain oss-decrypt --type workflows --name queue"
fi

# Test 3: Should pass subcommand arguments to prompt
((TESTS_RUN++))
if grep -q "ARGUMENTS" "$QUEUE_FILE" || grep -q "subcommand" "$QUEUE_FILE"; then
    pass "queue.md passes subcommand arguments"
else
    fail "queue.md should reference ARGUMENTS or subcommand passthrough"
fi

# Test 4: Should have description in frontmatter
((TESTS_RUN++))
if head -5 "$QUEUE_FILE" | grep -q "description:"; then
    pass "queue.md has description frontmatter"
else
    fail "queue.md should have description in frontmatter"
fi

# Summary
echo ""
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
