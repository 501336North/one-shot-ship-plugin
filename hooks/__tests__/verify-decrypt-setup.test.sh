#!/bin/bash
# Tests for verify-decrypt-setup.sh
#
# verify-decrypt-setup.sh is the single source of truth for "is the decrypt CLI
# genuinely ready" — it gates the /oss:login success banner and the auto-hook's
# "ready" message. It must declare success ONLY when the binary actually RUNS and
# credentials.enc exists; otherwise it surfaces the binary's real error and exits
# non-zero (never a false "Setup Complete").
#
# Usage: ./verify-decrypt-setup.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY_SCRIPT="$SCRIPT_DIR/../verify-decrypt-setup.sh"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

setup_test_env() {
    TEST_HOME=$(mktemp -d)
    export HOME="$TEST_HOME"
    mkdir -p "$TEST_HOME/.oss/bin"
}

teardown_test_env() {
    rm -rf "$TEST_HOME"
}

pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((TESTS_PASSED++)); }
fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    echo "  Expected: $2"
    echo "  Got: $3"
    ((TESTS_FAILED++))
}

# =============================================================================
# ACCEPTANCE TEST: a crashing binary makes verification FAIL loudly (no false success)
#
# @behavior /oss:login must NOT declare success when the decrypt binary crashes;
#           it surfaces the binary's stderr so the real failure is visible.
# @user-story As a user on any platform, a broken decrypt CLI fails login loudly
#           instead of printing "Setup Complete" while nothing is configured.
# @acceptance-criteria exit != 0, the binary's stderr is shown, NO success marker.
# @boundary verify-decrypt-setup.sh (CLI/system boundary that gates login success)
# @regression Reproduces the v1.2.2 arm64 crash: `Cannot find module
#             '/snapshot/dist/oss-decrypt.cjs'` that login wrongly reported as success.
# =============================================================================
test_crashing_binary_fails_verification() {
    local test_name="Crashing decrypt binary fails verification and surfaces its stderr"
    ((TESTS_RUN++))

    setup_test_env

    # GIVEN - an installed-but-crashing decrypt binary (v1.2.2 repro)
    cat > "$TEST_HOME/.oss/bin/oss-decrypt" << 'MOCKEOF'
#!/bin/bash
echo "Error: Cannot find module '/snapshot/dist/oss-decrypt.cjs'" >&2
exit 1
MOCKEOF
    chmod +x "$TEST_HOME/.oss/bin/oss-decrypt"
    # AND - setup never produced credentials
    rm -f "$TEST_HOME/.oss/credentials.enc"

    # WHEN - the verifier runs
    local result exit_code=0
    result=$("$VERIFY_SCRIPT" 2>&1) || exit_code=$?

    teardown_test_env

    # THEN - non-zero exit, the real stderr is surfaced, and NO success banner
    if [[ $exit_code -ne 0 ]] \
        && echo "$result" | grep -q "Cannot find module" \
        && ! echo "$result" | grep -qiE "verified|setup complete|successfully"; then
        pass "$test_name"
    else
        fail "$test_name" "exit != 0 + surfaced stderr + NO success marker" \
            "exit=$exit_code output: $result"
    fi
}

# =============================================================================
# Helper: install a WORKING mock binary that succeeds on --version/--setup
# =============================================================================
install_working_binary() {
    cat > "$TEST_HOME/.oss/bin/oss-decrypt" << 'MOCKEOF'
#!/bin/bash
if [[ "$1" == "--version" ]]; then echo "oss-decrypt v1.2.3"; exit 0
elif [[ "$1" == "--setup" ]]; then exit 0
else echo "mock"; fi
MOCKEOF
    chmod +x "$TEST_HOME/.oss/bin/oss-decrypt"
}

# =============================================================================
# TEST: binary runs but credentials.enc is MISSING ⇒ fail (no false success)
#
# @behavior --setup that did not produce credentials is reported as not-ready.
# @acceptance-criteria exit != 0, message names missing credentials, NO success.
# =============================================================================
test_missing_credentials_fails_verification() {
    local test_name="Runnable binary but missing credentials.enc fails verification"
    ((TESTS_RUN++))

    setup_test_env
    install_working_binary
    rm -f "$TEST_HOME/.oss/credentials.enc"   # setup never completed

    local result exit_code=0
    result=$("$VERIFY_SCRIPT" 2>&1) || exit_code=$?

    teardown_test_env

    if [[ $exit_code -ne 0 ]] \
        && echo "$result" | grep -qi "credential" \
        && ! echo "$result" | grep -qiE "verified|setup complete|successfully"; then
        pass "$test_name"
    else
        fail "$test_name" "exit != 0 + names credentials + NO success marker" \
            "exit=$exit_code output: $result"
    fi
}

# =============================================================================
# TEST: credentials.enc exists but is EMPTY ⇒ fail (non-empty required)
# =============================================================================
test_empty_credentials_fails_verification() {
    local test_name="Empty credentials.enc fails verification"
    ((TESTS_RUN++))

    setup_test_env
    install_working_binary
    : > "$TEST_HOME/.oss/credentials.enc"      # zero-byte file

    local result exit_code=0
    result=$("$VERIFY_SCRIPT" 2>&1) || exit_code=$?

    teardown_test_env

    if [[ $exit_code -ne 0 ]] && echo "$result" | grep -qi "credential"; then
        pass "$test_name"
    else
        fail "$test_name" "exit != 0 + names credentials" "exit=$exit_code output: $result"
    fi
}

# =============================================================================
# TEST: binary runs AND non-empty credentials.enc ⇒ success (exit 0 + marker)
# =============================================================================
test_healthy_setup_succeeds() {
    local test_name="Runnable binary + credentials present verifies successfully"
    ((TESTS_RUN++))

    setup_test_env
    install_working_binary
    echo "ENCRYPTED_CREDS_BLOB" > "$TEST_HOME/.oss/credentials.enc"

    local result exit_code=0
    result=$("$VERIFY_SCRIPT" 2>&1) || exit_code=$?

    teardown_test_env

    if [[ $exit_code -eq 0 ]] && echo "$result" | grep -qi "verified"; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0 + success marker 'verified'" "exit=$exit_code output: $result"
    fi
}

echo "Running verify-decrypt-setup.sh tests..."
echo "========================================"

test_crashing_binary_fails_verification
test_missing_credentials_fails_verification
test_empty_credentials_fails_verification
test_healthy_setup_succeeds

echo ""
echo "========================================"
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

[[ $TESTS_FAILED -gt 0 ]] && exit 1
exit 0
