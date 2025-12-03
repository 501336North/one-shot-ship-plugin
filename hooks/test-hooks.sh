#!/bin/bash
# Test suite for OSS hooks
# Run: ./hooks/test-hooks.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASSED=0
FAILED=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

test_pass() {
    echo -e "${GREEN}PASS${NC}: $1"
    PASSED=$((PASSED + 1))
}

test_fail() {
    echo -e "${RED}FAIL${NC}: $1"
    FAILED=$((FAILED + 1))
}

echo "========================================"
echo "OSS Hooks Test Suite"
echo "========================================"
echo ""

# Test 1: oss-context-inject.sh exists and is executable
echo "Test 1: oss-context-inject.sh exists and is executable"
if [[ -x "$SCRIPT_DIR/oss-context-inject.sh" ]]; then
    test_pass "oss-context-inject.sh exists and is executable"
else
    test_fail "oss-context-inject.sh missing or not executable"
fi

# Test 2: oss-context-inject.sh outputs git branch when in git repo
echo "Test 2: oss-context-inject.sh outputs git info in git repo"
cd "$SCRIPT_DIR/.."  # plugin root (is a git repo)
OUTPUT=$("$SCRIPT_DIR/oss-context-inject.sh" 2>/dev/null || echo "")
if echo "$OUTPUT" | grep -q "Branch:"; then
    test_pass "oss-context-inject.sh outputs Branch info"
else
    test_fail "oss-context-inject.sh does not output Branch info"
fi

# Test 3: oss-context-inject.sh outputs uncommitted changes count
echo "Test 3: oss-context-inject.sh outputs uncommitted changes"
if echo "$OUTPUT" | grep -q "Changes:"; then
    test_pass "oss-context-inject.sh outputs Changes count"
else
    test_fail "oss-context-inject.sh does not output Changes count"
fi

# Test 4: oss-session-start.sh exists and is executable
echo "Test 4: oss-session-start.sh exists and is executable"
if [[ -x "$SCRIPT_DIR/oss-session-start.sh" ]]; then
    test_pass "oss-session-start.sh exists and is executable"
else
    test_fail "oss-session-start.sh missing or not executable"
fi

# Test 5: oss-session-start.sh checks for config file
echo "Test 5: oss-session-start.sh handles missing config gracefully"
OUTPUT=$("$SCRIPT_DIR/oss-session-start.sh" 2>/dev/null || echo "")
# Should exit 0 even without config (graceful degradation)
if "$SCRIPT_DIR/oss-session-start.sh" >/dev/null 2>&1; then
    test_pass "oss-session-start.sh exits successfully without config"
else
    test_fail "oss-session-start.sh fails without config"
fi

# Test 6: oss-session-end.sh exists and is executable
echo "Test 6: oss-session-end.sh exists and is executable"
if [[ -x "$SCRIPT_DIR/oss-session-end.sh" ]]; then
    test_pass "oss-session-end.sh exists and is executable"
else
    test_fail "oss-session-end.sh missing or not executable"
fi

# Test 7: oss-session-end.sh creates context file
echo "Test 7: oss-session-end.sh saves context"
rm -f ~/.oss/session-context.md 2>/dev/null || true
"$SCRIPT_DIR/oss-session-end.sh" >/dev/null 2>&1 || true
if [[ -f ~/.oss/session-context.md ]]; then
    test_pass "oss-session-end.sh creates session-context.md"
else
    test_fail "oss-session-end.sh does not create session-context.md"
fi

# Test 8: hooks.json includes all new hooks
echo "Test 8: hooks.json includes UserPromptSubmit hook"
if grep -q "UserPromptSubmit" "$SCRIPT_DIR/hooks.json"; then
    test_pass "hooks.json has UserPromptSubmit hook"
else
    test_fail "hooks.json missing UserPromptSubmit hook"
fi

# Test 9: hooks.json includes SessionStart
echo "Test 9: hooks.json includes SessionStart hook"
if grep -q "SessionStart" "$SCRIPT_DIR/hooks.json"; then
    test_pass "hooks.json has SessionStart hook"
else
    test_fail "hooks.json missing SessionStart hook"
fi

# Test 10: hooks.json includes PreCompact (SessionEnd equivalent)
echo "Test 10: hooks.json includes PreCompact hook"
if grep -q "PreCompact" "$SCRIPT_DIR/hooks.json"; then
    test_pass "hooks.json has PreCompact hook"
else
    test_fail "hooks.json missing PreCompact hook"
fi

# Test 11: MCP servers configuration exists
echo "Test 11: mcp_servers.json exists"
if [[ -f "$SCRIPT_DIR/../mcp_servers.json" ]]; then
    test_pass "mcp_servers.json exists"
else
    test_fail "mcp_servers.json missing"
fi

# Test 12: GitHub MCP server is configured
echo "Test 12: GitHub MCP server is configured"
if grep -q "github" "$SCRIPT_DIR/../mcp_servers.json" 2>/dev/null; then
    test_pass "GitHub MCP server is configured"
else
    test_fail "GitHub MCP server not configured"
fi

# Test 13: Linear MCP server is configured
echo "Test 13: Linear MCP server is configured"
if grep -q "linear" "$SCRIPT_DIR/../mcp_servers.json" 2>/dev/null; then
    test_pass "Linear MCP server is configured"
else
    test_fail "Linear MCP server not configured"
fi

# Test 14: Slack MCP server is configured
echo "Test 14: Slack MCP server is configured"
if grep -q "slack" "$SCRIPT_DIR/../mcp_servers.json" 2>/dev/null; then
    test_pass "Slack MCP server is configured"
else
    test_fail "Slack MCP server not configured"
fi

# Test 15: /oss:status command exists
echo "Test 15: oss:status command file exists"
if [[ -f "$SCRIPT_DIR/../commands/oss-status.md" ]]; then
    test_pass "oss-status.md command exists"
else
    test_fail "oss-status.md command missing"
fi

# Test 16: commands/oss/ directory exists for colon syntax
echo "Test 16: commands/oss/ directory exists"
if [[ -d "$SCRIPT_DIR/../commands/oss" ]]; then
    test_pass "commands/oss/ directory exists"
else
    test_fail "commands/oss/ directory missing"
fi

# Test 17: /oss:ideate command exists
echo "Test 17: /oss:ideate command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/ideate.md" ]]; then
    test_pass "/oss:ideate command exists"
else
    test_fail "/oss:ideate command missing"
fi

# Test 18: /oss:plan command exists
echo "Test 18: /oss:plan command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/plan.md" ]]; then
    test_pass "/oss:plan command exists"
else
    test_fail "/oss:plan command missing"
fi

# Test 19: /oss:build command exists
echo "Test 19: /oss:build command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/build.md" ]]; then
    test_pass "/oss:build command exists"
else
    test_fail "/oss:build command missing"
fi

# Test 20: /oss:ship command exists
echo "Test 20: /oss:ship command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/ship.md" ]]; then
    test_pass "/oss:ship command exists"
else
    test_fail "/oss:ship command missing"
fi

# Test 21: /oss:ship mentions --merge flag
echo "Test 21: /oss:ship supports --merge flag"
if grep -q "\-\-merge" "$SCRIPT_DIR/../commands/oss/ship.md" 2>/dev/null; then
    test_pass "/oss:ship documents --merge flag"
else
    test_fail "/oss:ship missing --merge flag documentation"
fi

# Test 22: /oss:docs command exists
echo "Test 22: /oss:docs command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/docs.md" ]]; then
    test_pass "/oss:docs command exists"
else
    test_fail "/oss:docs command missing"
fi

# Test 23: /oss:test command exists
echo "Test 23: /oss:test command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/test.md" ]]; then
    test_pass "/oss:test command exists"
else
    test_fail "/oss:test command missing"
fi

# Test 24: /oss:bench command exists
echo "Test 24: /oss:bench command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/bench.md" ]]; then
    test_pass "/oss:bench command exists"
else
    test_fail "/oss:bench command missing"
fi

# Test 25: /oss:audit command exists
echo "Test 25: /oss:audit command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/audit.md" ]]; then
    test_pass "/oss:audit command exists"
else
    test_fail "/oss:audit command missing"
fi

# Test 26: /oss:stage command exists
echo "Test 26: /oss:stage command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/stage.md" ]]; then
    test_pass "/oss:stage command exists"
else
    test_fail "/oss:stage command missing"
fi

# Test 27: /oss:deploy command exists
echo "Test 27: /oss:deploy command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/deploy.md" ]]; then
    test_pass "/oss:deploy command exists"
else
    test_fail "/oss:deploy command missing"
fi

# Test 28: /oss:release command exists
echo "Test 28: /oss:release command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/release.md" ]]; then
    test_pass "/oss:release command exists"
else
    test_fail "/oss:release command missing"
fi

# Test 29: /oss:monitor command exists
echo "Test 29: /oss:monitor command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/monitor.md" ]]; then
    test_pass "/oss:monitor command exists"
else
    test_fail "/oss:monitor command missing"
fi

# Test 30: /oss:incident command exists
echo "Test 30: /oss:incident command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/incident.md" ]]; then
    test_pass "/oss:incident command exists"
else
    test_fail "/oss:incident command missing"
fi

# Test 31: /oss:rollback command exists
echo "Test 31: /oss:rollback command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/rollback.md" ]]; then
    test_pass "/oss:rollback command exists"
else
    test_fail "/oss:rollback command missing"
fi

# Test 32: /oss:login command exists
echo "Test 32: /oss:login command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/login.md" ]]; then
    test_pass "/oss:login command exists"
else
    test_fail "/oss:login command missing"
fi

# Test 33: /oss:status command exists in oss folder
echo "Test 33: /oss:status command exists"
if [[ -f "$SCRIPT_DIR/../commands/oss/status.md" ]]; then
    test_pass "/oss:status command exists"
else
    test_fail "/oss:status command missing"
fi

# Test 34: Count total commands in oss folder
echo "Test 34: Total commands count"
TOTAL=$(ls -1 "$SCRIPT_DIR/../commands/oss/"*.md 2>/dev/null | wc -l | tr -d ' ')
if [[ "$TOTAL" -ge 16 ]]; then
    test_pass "Have $TOTAL commands (expected 16+)"
else
    test_fail "Only $TOTAL commands (expected 16+)"
fi

# Summary
echo ""
echo "========================================"
echo "Results: $PASSED passed, $FAILED failed"
echo "========================================"

if [[ $FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
