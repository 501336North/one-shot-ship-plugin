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
# 5. An installed CLI is still ensured first (SR6); when that fails, exit 1 and the CLI is not run

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The hook runs from a throwaway copy of hooks/ whose ensure-decrypt-cli.sh is a stub (SR6: the hook runs it before
# every sync): it records each call in $HOME/.ensure-calls, fails when $HOME/.ensure-fail exists, keeps an installed CLI; a missing CLI "fails to install"
# after asking GitHub (the curl tripwire records that). The real installer has its own suites.
HOOK_TREE=$(mktemp -d); trap 'rm -rf "$HOOK_TREE"' EXIT
cp "$SCRIPT_DIR/../fetch-iron-laws.sh" "$SCRIPT_DIR/../oss-api-curl.sh" "$HOOK_TREE/"
cat > "$HOOK_TREE/ensure-decrypt-cli.sh" << 'ENSUREEOF'
#!/bin/bash
echo ensure >> "$HOME/.ensure-calls"
[[ -f "$HOME/.ensure-fail" ]] && exit 1   # e.g. the pinned CLI failed verification
[[ -x "$HOME/.oss/bin/oss-decrypt" ]] && exit 0
curl -fsSL "https://github.com/501336North/one-shot-ship-plugin/releases/download/stub/oss-decrypt" -o /dev/null
exit 1
ENSUREEOF
chmod +x "$HOOK_TREE/ensure-decrypt-cli.sh"
HOOK_SCRIPT="$HOOK_TREE/fetch-iron-laws.sh"

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
    # curl records every call; it serves $TEST_HOME/custom for ?part=custom (SR16), anything else fails (exit 7).
    printf '#!/bin/bash\necho "$*" >> "%s/curl-called"\ncase "$*" in *part=custom*) [[ -f "%s/custom" ]] && { cat "%s/custom"; exit 0; } ;; esac\nexit 7\n' \
        "$TEST_HOME" "$TEST_HOME" "$TEST_HOME" > "$MOCK_BIN_DIR/curl"
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
    grep -qv 'part=custom' "$TEST_HOME/curl-called" 2>/dev/null && curl_called=y   # only the team section may use curl (SR16)
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
    local curl_called=n; grep -qv 'part=custom' "$TEST_HOME/curl-called" 2>/dev/null && curl_called=y
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
# SR6: the pinned decrypt CLI is ensured before every fetch (an outdated or wrong-channel CLI is upgraded);
# when that fails, the installed CLI is not run and no laws are printed.
# =============================================================================
test_installed_cli_still_ensured() {
    local test_name="An installed oss-decrypt is still ensured before the fetch (once)"
    ((TESTS_RUN++))
    make_sandbox
    run_hook
    local n=0; [[ -f "$TEST_HOME/.ensure-calls" ]] && n=$(wc -l < "$TEST_HOME/.ensure-calls" | tr -d ' ')
    cleanup
    if [[ $exit_code -eq 0 && "$n" == 1 ]]; then pass "$test_name"
    else fail "$test_name" "exit 0, ensure-decrypt-cli.sh ran once" "exit=$exit_code ensure calls=$n output: $result"; fi
}
test_ensure_failure_prints_no_laws() {
    local test_name="ensure-decrypt-cli.sh fails with a CLI installed → exit 1, the CLI is not run, no laws"
    ((TESTS_RUN++))
    make_sandbox; touch "$TEST_HOME/.ensure-fail"
    run_hook
    local ran=n; [[ -f "$TEST_HOME/cli-argv" ]] && ran=y
    cleanup
    if [[ $exit_code -eq 1 && "$ran" == n && "$result" != *"LAW 1"* ]]; then pass "$test_name"
    else fail "$test_name" "exit 1, CLI not run, no laws" "exit=$exit_code ran=$ran output: $result"; fi
}

# =============================================================================
# SR16: below the verified laws, the team/personal section (?part=custom) marked unverified; none, empty or a failed
# fetch: the verified laws alone, still exit 0. An untrusted apiUrl: exit 1 before any curl (the key never leaves).
# =============================================================================
NOTE='> Team/personal laws below are not covered by the signed prompt manifest (unverified).'
CLOSE='> End of unverified team/personal laws.'   # TR2: the section ends with a fixed line the team text cannot forge
test_custom_section_printed() {
    local test_name="The team section is printed below the verified laws, marked unverified, control characters stripped"
    ((TESTS_RUN++))
    make_sandbox; printf '## Custom Personal Laws\n- Mine: \033[1mbold\033[0m\n' > "$TEST_HOME/custom"
    run_hook --raw
    cleanup
    if [[ $exit_code -eq 0 && "$result" == *"LAW 1: TDD"*"$NOTE"*"## Custom Personal Laws"*"- Mine: [1mbold[0m"*$'\n\n'"$CLOSE" && "$result" != *$'\033'* ]]; then pass "$test_name"
    else fail "$test_name" "exit 0, laws, note, section, closing line last, no ESC" "exit=$exit_code output: $result"; fi
}
test_custom_section_absent() {
    local mode
    for mode in empty fail oversized; do
        local test_name="Team section $mode → the verified laws alone, no unverified note, exit 0"
        ((TESTS_RUN++))
        make_sandbox; [[ $mode == empty ]] && : > "$TEST_HOME/custom"
        [[ $mode == oversized ]] && { printf '## Custom Team Laws\n\n'; head -c 20000 /dev/zero | tr '\0' 'x'; printf '\n'; } > "$TEST_HOME/custom"   # TR3
        run_hook --raw
        local asked=n; grep -q 'part=custom' "$TEST_HOME/curl-called" 2>/dev/null && asked=y
        cleanup
        if [[ $exit_code -eq 0 && "$result" == *"LAW 1: TDD"* && "$result" != *unverified* && $asked == y ]]; then pass "$test_name"
        else fail "$test_name" "exit 0, laws, no note, the section was asked for" "exit=$exit_code asked=$asked output: $result"; fi
    done
}
test_custom_section_untrusted_api() {
    local test_name="An untrusted apiUrl → exit 1 and no curl at all"
    ((TESTS_RUN++))
    make_sandbox; echo '{"apiKey": "test-key-123", "apiUrl": "https://api.example.com"}' > "$TEST_HOME/.oss/config.json"
    printf '## Custom Team Laws\n- x\n' > "$TEST_HOME/custom"
    run_hook --raw
    local curled=n; [[ -s "$TEST_HOME/curl-called" ]] && curled=y
    cleanup
    if [[ $exit_code -eq 1 && $curled == n && "$result" != *"Custom Team Laws"* ]]; then pass "$test_name"
    else fail "$test_name" "exit 1, no curl" "exit=$exit_code curled=$curled output: $result"; fi
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
test_installed_cli_still_ensured
test_ensure_failure_prints_no_laws
test_custom_section_printed
test_custom_section_absent
test_custom_section_untrusted_api

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
