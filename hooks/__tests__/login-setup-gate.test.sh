#!/bin/bash
# Contract tests for commands/login.md setup gating.
#
# login.md is a clear-text bootstrap command (no API-served copy). It must gate
# its install-success claim on the real verifier (verify-decrypt-setup.sh), not
# on a bare `[ -x oss-decrypt ]` file-exists check that a crashing binary passes.
#
# Usage: ./login-setup-gate.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGIN_MD="$SCRIPT_DIR/../../commands/login.md"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((TESTS_PASSED++)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; echo "  Expected: $2"; echo "  Got: $3"; ((TESTS_FAILED++)); }

# =============================================================================
# @behavior /oss:login declares setup success only via the real verifier.
# @acceptance-criteria login.md references verify-decrypt-setup.sh.
# =============================================================================
test_login_references_verifier() {
    local test_name="login.md gates setup success on verify-decrypt-setup.sh"
    ((TESTS_RUN++))
    if grep -q "verify-decrypt-setup.sh" "$LOGIN_MD"; then
        pass "$test_name"
    else
        fail "$test_name" "login.md references verify-decrypt-setup.sh" "no reference found"
    fi
}

# =============================================================================
# @behavior The old false-positive success line (guarded only by `[ -x ]`) is gone.
# @acceptance-criteria login.md no longer prints an unconditional
#           'CLI installed successfully' that a crashing-but-present binary passes.
# =============================================================================
test_login_no_false_success_line() {
    local test_name="login.md no longer prints success on a bare [ -x ] check"
    ((TESTS_RUN++))
    if ! grep -q 'echo "CLI installed successfully"' "$LOGIN_MD"; then
        pass "$test_name"
    else
        fail "$test_name" "no unconditional 'CLI installed successfully' echo" \
            "found the false-positive success line still gated by [ -x ]"
    fi
}

echo "Running login.md setup-gate contract tests..."
echo "============================================="
test_login_references_verifier
test_login_no_false_success_line
echo ""
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -gt 0 ]] && exit 1
exit 0
