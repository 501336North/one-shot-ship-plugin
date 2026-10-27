#!/bin/bash
# Tests for fetch-iron-laws.sh hook
#
# Usage: ./fetch-iron-laws.test.sh
#
# Tests:
# 1. Exits 0 and outputs the laws the decrypt CLI verified (non-raw mode), never curl
# 2. Exits 1 and points at /oss:login when the API rejects the key
# 3. A CLI refusal prints no laws and never falls back to curl
# 4. A missing CLI is installed first; when that fails, exit 1

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/../fetch-iron-laws.sh"

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

# The laws come only from the decrypt CLI (FR15): it verifies them against the signed manifest and
# prints them, or refuses. make_sandbox puts a stub CLI at $TEST_HOME/.oss/bin/oss-decrypt (driven by
# $TEST_HOME/cli-mode) that records its argv, and a curl tripwire on PATH that records any call.
make_sandbox() {
    TEST_HOME=$(mktemp -d)
    MOCK_BIN_DIR=$(mktemp -d)
    mkdir -p "$TEST_HOME/.oss/bin"
    echo '{"apiKey": "test-key-123"}' > "$TEST_HOME/.oss/config.json"
    cat > "$TEST_HOME/.oss/bin/oss-decrypt" << CLIEOF
#!/bin/bash
echo "\$*" >> "$TEST_HOME/cli-argv"
case "\$(cat "$TEST_HOME/cli-mode" 2>/dev/null)" in
    unauthorized) echo "Error: Unauthorized" >&2; exit 1 ;;
    refused) echo "# IRON LAWS (tampered)"; echo "[verify] Prompt hash: FAILED — prompt blocked" >&2
             echo "Error: [SECURITY] Prompt integrity check FAILED. Content may have been tampered with." >&2; exit 1 ;;
    unreachable) echo "Error: fetch failed" >&2; exit 1 ;;
esac
printf '# IRON LAWS\n\n## LAW 1: TDD\n\n'
CLIEOF
    chmod +x "$TEST_HOME/.oss/bin/oss-decrypt"
    printf '#!/bin/bash\necho "$*" >> "%s/curl-called"\nexit 7\n' "$TEST_HOME" > "$MOCK_BIN_DIR/curl"
    chmod +x "$MOCK_BIN_DIR/curl"
}
run_hook() { # sets result, exit_code
    exit_code=0
    result=$(HOME="$TEST_HOME" CLAUDE_PLUGIN_ROOT="$TEST_HOME/no-plugin" PATH="$MOCK_BIN_DIR:$PATH" "$HOOK_SCRIPT" "$@" 2>&1) || exit_code=$?
}
cleanup() { rm -rf "$TEST_HOME" "$MOCK_BIN_DIR"; }

# =============================================================================
# TEST 1: Outputs the verified laws (non-raw mode)
#
# @behavior fetch-iron-laws prints the laws the decrypt CLI verified
# @acceptance-criteria Script exits 0, outputs the markdown, asked the CLI for shared/iron-laws, no curl
# @boundary fetch-iron-laws.sh (system boundary)
# =============================================================================
test_plain_markdown_response() {
    local test_name="Exits 0 and outputs the laws from 'oss-decrypt --type shared --name iron-laws', never curl"
    ((TESTS_RUN++))
    make_sandbox
    run_hook
    local argv curl_called=n
    argv=$(cat "$TEST_HOME/cli-argv" 2>/dev/null)
    [[ -f "$TEST_HOME/curl-called" ]] && curl_called=y
    cleanup
    if [[ $exit_code -eq 0 ]] && echo "$result" | grep -q "IRON LAWS" && [[ "$argv" == "--type shared --name iron-laws" && "$curl_called" == n ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0 + 'IRON LAWS', CLI argv exact, no curl" "exit=$exit_code argv=$argv curl=$curl_called output: $result"
    fi
}

# =============================================================================
# TEST 2: Exits 1 when the API rejects the key
#
# @behavior fetch-iron-laws reports an auth failure and points at /oss:login
# @acceptance-criteria Script exits 1 when the CLI reports Unauthorized
# @boundary fetch-iron-laws.sh (system boundary)
# =============================================================================
test_api_error_response() {
    local test_name="Exits 1 and points at /oss:login when the API returns 401"
    ((TESTS_RUN++))
    make_sandbox; echo unauthorized > "$TEST_HOME/cli-mode"
    run_hook
    cleanup
    if [[ $exit_code -eq 1 ]] && [[ "$result" == *"/oss:login"* ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 1 + /oss:login" "exit=$exit_code output: $result"
    fi
}

# =============================================================================
# TEST 3: A CLI refusal prints no laws and never falls back to curl
#
# @behavior Laws that fail the signed-manifest check never reach the caller
# @business-rule FR15: IRON LAWS reach the user only after verification (fail closed)
# =============================================================================
test_refusal_prints_no_laws() {
    local test_name="CLI refusal (hash mismatch) → non-zero, no laws on stdout, no curl fallback"
    ((TESTS_RUN++))
    make_sandbox; echo refused > "$TEST_HOME/cli-mode"
    local out exit_code=0
    out=$(HOME="$TEST_HOME" CLAUDE_PLUGIN_ROOT="$TEST_HOME/no-plugin" PATH="$MOCK_BIN_DIR:$PATH" "$HOOK_SCRIPT" 2>/dev/null) || exit_code=$?
    local curl_called=n; [[ -f "$TEST_HOME/curl-called" ]] && curl_called=y
    cleanup
    if [[ $exit_code -ne 0 && "$out" != *"IRON LAWS"* && "$curl_called" == n ]]; then
        pass "$test_name"
    else
        fail "$test_name" "non-zero, no laws on stdout, no curl" "exit=$exit_code curl=$curl_called stdout: $out"
    fi
}

# =============================================================================
# TEST 4: A missing CLI is installed first; if that fails, no laws and no curl to the API
#
# @behavior fetch-iron-laws runs ensure-decrypt-cli.sh when oss-decrypt is missing
# =============================================================================
test_missing_cli_installs_first() {
    local test_name="oss-decrypt missing → installer runs; when it fails, exit 1 and no curl to the laws endpoint"
    ((TESTS_RUN++))
    make_sandbox; rm -f "$TEST_HOME/.oss/bin/oss-decrypt"
    run_hook
    local installer=n laws_curl=n
    grep -q 'github.com' "$TEST_HOME/curl-called" 2>/dev/null && installer=y
    grep -q 'iron-laws' "$TEST_HOME/curl-called" 2>/dev/null && laws_curl=y
    cleanup
    if [[ $exit_code -eq 1 && "$installer" == y && "$laws_curl" == n ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 1, installer tried, no laws curl" "exit=$exit_code installer=$installer laws_curl=$laws_curl output: $result"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running fetch-iron-laws.sh tests..."
echo "======================================="

test_plain_markdown_response
test_api_error_response
test_refusal_prints_no_laws
test_missing_cli_installs_first

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
