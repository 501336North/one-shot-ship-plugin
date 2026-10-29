#!/bin/bash
# Tests for fetch-iron-laws.sh hook
#
# Usage: ./fetch-iron-laws.test.sh
#
# Tests:
# 1. Exits 0 and outputs content when API returns plain markdown (non-raw mode)
# 2. Exits 1 when API returns non-200 status
# 3-6. The keyed request goes to the configured apiUrl with that config's key (OSS_CONFIG_DIR
#      honoured); a refused apiUrl gets no request; no apiUrl means the default API

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# HOOKS_UNDER_TEST=/path/to/hooks-copy runs these tests against a copy (mutants).
HOOK_SCRIPT="${HOOKS_UNDER_TEST:-$SCRIPT_DIR/..}/fetch-iron-laws.sh"

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
# TEST 1: Exits 0 when API returns plain markdown (non-raw mode)
#
# @behavior fetch-iron-laws outputs content when API returns plain markdown
# @acceptance-criteria Script exits 0, outputs the markdown body
# @boundary fetch-iron-laws.sh (system boundary)
# =============================================================================
test_plain_markdown_response() {
    local test_name="Exits 0 and outputs content when API returns plain markdown"
    ((TESTS_RUN++))

    TEST_HOME=$(mktemp -d)

    # Create config with API key
    mkdir -p "$TEST_HOME/.oss"
    echo '{"apiKey": "test-key-123"}' > "$TEST_HOME/.oss/config.json"

    # Create mock curl that returns plain markdown with 200 status code
    MOCK_BIN_DIR=$(mktemp -d)
    cat > "$MOCK_BIN_DIR/curl" << 'CURLEOF'
#!/bin/bash
# Mock curl: return plain markdown body + 200 status code
# curl uses -w "\n%{http_code}" so last line is the status
echo "# IRON LAWS"
echo ""
echo "## LAW 1: TDD"
echo ""
echo "200"
CURLEOF
    chmod +x "$MOCK_BIN_DIR/curl"

    # Run hook with mock curl and mock HOME
    local result exit_code=0
    result=$(HOME="$TEST_HOME" PATH="$MOCK_BIN_DIR:$PATH" "$HOOK_SCRIPT" 2>&1) || exit_code=$?

    rm -rf "$TEST_HOME" "$MOCK_BIN_DIR"

    if [[ $exit_code -eq 0 ]] && echo "$result" | grep -q "IRON LAWS"; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0 + output containing 'IRON LAWS'" "exit=$exit_code output: $result"
    fi
}

# =============================================================================
# TEST 2: Exits 1 when API returns non-200 status
#
# @behavior fetch-iron-laws reports error on API failure
# @acceptance-criteria Script exits 1 on 401 response
# @boundary fetch-iron-laws.sh (system boundary)
# =============================================================================
test_api_error_response() {
    local test_name="Exits 1 when API returns 401 status"
    ((TESTS_RUN++))

    TEST_HOME=$(mktemp -d)

    mkdir -p "$TEST_HOME/.oss"
    echo '{"apiKey": "bad-key"}' > "$TEST_HOME/.oss/config.json"

    MOCK_BIN_DIR=$(mktemp -d)
    cat > "$MOCK_BIN_DIR/curl" << 'CURLEOF'
#!/bin/bash
echo '{"error":"Unauthorized"}'
echo "401"
CURLEOF
    chmod +x "$MOCK_BIN_DIR/curl"

    local result exit_code=0
    result=$(HOME="$TEST_HOME" PATH="$MOCK_BIN_DIR:$PATH" "$HOOK_SCRIPT" 2>&1) || exit_code=$?

    rm -rf "$TEST_HOME" "$MOCK_BIN_DIR"

    if [[ $exit_code -ne 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit non-zero" "exit=$exit_code output: $result"
    fi
}

# =============================================================================
# TESTS 3-6: the key goes only to the configured API, with that config's key
#
# @behavior fetch-iron-laws sends its keyed request to <apiUrl>/api/v1/prompts/shared/iron-laws,
#           apiUrl and apiKey both read from the one OSS config file (OSS_CONFIG_DIR, else ~/.oss);
#           no apiUrl means the default API; an apiUrl the CLI would refuse means no request.
# @business-rule The API key is only ever sent to the API the user configured.
# @boundary fetch-iron-laws.sh (system boundary); curl is the faked collaborator
# =============================================================================
source "$SCRIPT_DIR/lib/warm-stub.sh"
KS=$(mktemp -d); KS=$(cd "$KS" && pwd -P)
# One recording curl for every case, warmed once: argv (a line per call), the --config - stdin
# (where the Authorization header travels), and a canned 200 laws body.
KS_WARM=y
warm_stub "$KS/bin/curl" "$(cat <<'EOF'
printf '%s\n' "$*" >> "$SHIM/argv"
prev=""; for a in "$@"; do [[ "$prev" == --config && "$a" == - ]] && cat >> "$SHIM/stdin"; prev="$a"; done
printf '# IRON LAWS\n\n200'
EOF
)" || KS_WARM=n

key_case() { # $1 case dir, $2 ~/.oss/config.json body, [$3 OSS_CONFIG_DIR config.json body]
    SHIM="$KS/$1"; mkdir -p "$SHIM/home/.oss"
    printf '%s' "$2" > "$SHIM/home/.oss/config.json"
    local cfgdir=""
    if [[ -n "${3:-}" ]]; then cfgdir="$SHIM/alt"; mkdir -p "$cfgdir"; printf '%s' "$3" > "$cfgdir/config.json"; fi
    RC=0
    OUT=$(cd "$SHIM" && SHIM="$SHIM" HOME="$SHIM/home" OSS_CONFIG_DIR="$cfgdir" CLAUDE_PLUGIN_ROOT="" \
        PATH="$KS/bin:$PATH" /bin/bash "$HOOK_SCRIPT" </dev/null 2>&1) || RC=$?
    CALLS=0; ARGV=""
    if [[ -f "$SHIM/argv" ]]; then CALLS=$(wc -l < "$SHIM/argv" | tr -d ' '); ARGV=$(tr '\n' '|' < "$SHIM/argv"); fi
}
sent_key() { grep -qF "Authorization: Bearer $1\"" "$SHIM/stdin" 2>/dev/null; }

test_configured_api_url() {
    local test_name="apiUrl in the config: the one request goes there with the config's key, never to onrender"
    ((TESTS_RUN++))
    key_case a '{"apiKey":"fake-key-K","apiUrl":"http://127.0.0.1:9"}'
    if [[ $KS_WARM == y && $RC -eq 0 && $CALLS == 1 && "$ARGV" == *" http://127.0.0.1:9/api/v1/prompts/shared/iron-laws|" \
          && "$ARGV" != *onrender* ]] && sent_key fake-key-K; then pass "$test_name"
    else fail "$test_name" "exit 0, 1 call to http://127.0.0.1:9/api/v1/prompts/shared/iron-laws with fake-key-K" \
        "warm=$KS_WARM exit=$RC calls=$CALLS argv=$ARGV"; fi
}

test_oss_config_dir_key_and_url() {
    local test_name="OSS_CONFIG_DIR set: its key (KB) and its apiUrl are used, ~/.oss's key (KA) is never sent"
    ((TESTS_RUN++))
    key_case b '{"apiKey":"fake-key-KA"}' '{"apiKey":"fake-key-KB","apiUrl":"http://127.0.0.1:9"}'
    if [[ $RC -eq 0 && $CALLS == 1 && "$ARGV" == *" http://127.0.0.1:9/api/v1/prompts/shared/iron-laws|" ]] \
          && sent_key fake-key-KB && ! grep -qF fake-key-KA "$SHIM/stdin" "$SHIM/argv"; then pass "$test_name"
    else fail "$test_name" "1 call to 127.0.0.1:9 carrying fake-key-KB only" \
        "exit=$RC calls=$CALLS argv=$ARGV sent=$(grep -o 'Bearer [^"]*' "$SHIM/stdin" 2>/dev/null)"; fi
}

test_invalid_api_url_no_request() {
    local test_name="apiUrl the CLI refuses (http://evil.example): no keyed request, exit 1 with an error"
    ((TESTS_RUN++))
    key_case c '{"apiKey":"fake-key-K","apiUrl":"http://evil.example"}'
    if [[ $RC -eq 1 && $CALLS == 0 && "$OUT" == *Error* ]]; then pass "$test_name"
    else fail "$test_name" "exit 1, no curl call, an Error line" "exit=$RC calls=$CALLS argv=$ARGV out=$OUT"; fi
}

test_no_api_url_default_host() {
    local test_name="control: no apiUrl in the config → the default API"
    ((TESTS_RUN++))
    key_case d '{"apiKey":"fake-key-K"}'
    if [[ $RC -eq 0 && $CALLS == 1 && "$ARGV" == *" https://one-shot-ship-api.onrender.com/api/v1/prompts/shared/iron-laws|" ]] \
          && sent_key fake-key-K; then pass "$test_name"
    else fail "$test_name" "1 call to the default API with fake-key-K" "exit=$RC calls=$CALLS argv=$ARGV"; fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running fetch-iron-laws.sh tests..."
echo "======================================="

test_plain_markdown_response
test_api_error_response
test_configured_api_url
test_oss_config_dir_key_and_url
test_invalid_api_url_no_request
test_no_api_url_default_host
rm -rf "$KS"

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
