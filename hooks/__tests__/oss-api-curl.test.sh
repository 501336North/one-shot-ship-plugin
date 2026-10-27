#!/bin/bash
# Tests for hooks/oss-api-curl.sh - the one place hooks hand the API key to curl.
#
# @behavior Every hook that calls the OSS API authenticates without the API key ever
#           appearing in a process command line (visible to every local user via `ps`).
# @business-rule The key is passed to curl on stdin (`curl --config -`), never in argv.
#           One shared helper answers "how do we send the key", so no hook can drift
#           back to `-H "Authorization: Bearer $KEY"` (IRON LAW #1b provenance).
#
# Usage: ./hooks/__tests__/oss-api-curl.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER="$HOOKS_DIR/oss-api-curl.sh"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((TESTS_PASSED++)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; echo "  Expected: $2"; echo "  Got: $3"; ((TESTS_FAILED++)); }

FAKE_KEY='fake-key-feedfacecafe0042'

setup() { # T/home with config, T/bin/curl shim recording argv + --config stdin
    T=$(mktemp -d)
    mkdir -p "$T/home/.oss" "$T/bin" "$T/shim"
    printf '{"apiKey": "%s"}\n' "$FAKE_KEY" > "$T/home/.oss/config.json"
    cat > "$T/bin/curl" << SHIM
#!/bin/bash
S="$T/shim"
printf '%s\n' "\$*" >> "\$S/argv"
prev=""
for a in "\$@"; do
    if [[ ( "\$prev" == "--config" || "\$prev" == "-K" ) && "\$a" == "-" ]]; then cat >> "\$S/stdin"; fi
    prev="\$a"
done
printf '# IRON LAWS\nbody\n\n200'
SHIM
    chmod +x "$T/bin/curl"
}
teardown() { rm -rf "$T"; }

key_in_argv() { grep -qF "$FAKE_KEY" "$T/shim/argv" 2>/dev/null && echo y || echo n; }
key_in_cfg()  { grep -qF "Authorization: Bearer $FAKE_KEY" "$T/shim/stdin" 2>/dev/null && echo y || echo n; }

# --- the helper itself ---------------------------------------------------------------------
test_helper_key_on_stdin() {
    local name="helper: key goes to curl's --config stdin, never argv; other args pass through"; ((TESTS_RUN++)); setup
    local out
    out=$(PATH="$T/bin:$PATH" bash -c 'source "$1"; oss_api_curl "$2" -s https://example.invalid/x' _ "$HELPER" "$FAKE_KEY" 2>&1)
    if [[ "$(key_in_argv)" == n && "$(key_in_cfg)" == y && "$(cat "$T/shim/argv" 2>/dev/null)" == *"https://example.invalid/x"* && "$out" == *"IRON LAWS"* ]]; then pass "$name"
    else fail "$name" "argv=n config=y url passed, stdout returned" "argv=$(key_in_argv) config=$(key_in_cfg) out=${out//$FAKE_KEY/<KEY>}"; fi
    teardown
}

test_helper_escapes_and_refuses() {
    local name="helper: quotes/backslashes are escaped for curl config; a key with a newline is refused"; ((TESTS_RUN++)); setup
    PATH="$T/bin:$PATH" bash -c 'source "$1"; oss_api_curl "$2" -s https://example.invalid/' _ "$HELPER" 'a"b\c' >/dev/null 2>&1
    local esc=n; grep -qF 'Authorization: Bearer a\"b\\c"' "$T/shim/stdin" 2>/dev/null && esc=y
    rm -f "$T/shim/argv"
    local rc=0
    PATH="$T/bin:$PATH" bash -c 'source "$1"; oss_api_curl "$2" -s https://example.invalid/' _ "$HELPER" $'bad\nkey' >/dev/null 2>&1 || rc=$?
    if [[ "$esc" == y && $rc -ne 0 && ! -f "$T/shim/argv" ]]; then pass "$name"
    else fail "$name" "escaped config line; newline key → non-zero, no curl" "escaped=$esc rc=$rc curl_called=$([[ -f $T/shim/argv ]] && echo y || echo n)"; fi
    teardown
}

# --- every hook site routes through the helper (provenance guard) -----------------------------
test_no_hook_puts_key_in_argv() {
    local name="guard: no tracked hook interpolates a variable into an Authorization: Bearer header"; ((TESTS_RUN++))
    local offenders
    offenders=$(cd "$HOOKS_DIR/.." && git ls-files 'hooks/*.sh' | grep -v '^hooks/__tests__/' | grep -v '^hooks/oss-api-curl.sh$' \
        | xargs grep -nE 'Bearer[[:space:]]+\$' 2>/dev/null)
    if [[ -z "$offenders" ]]; then pass "$name"
    else fail "$name" "no matches" "$offenders"; fi
}

# --- behavioural, per site --------------------------------------------------------------------
check_site() { # $1 label, then the command to run under the temp HOME/PATH
    local label="$1"; shift
    local name="site: $label sends the key via the helper (not argv)"; ((TESTS_RUN++)); setup
    (cd "$T" && HOME="$T/home" PATH="$T/bin:$PATH" OSS_SKIP_HEALTH_CHECK='' perl -e 'alarm 30; exec @ARGV' "$@" </dev/null >/dev/null 2>&1)
    if [[ "$(key_in_argv)" == n && "$(key_in_cfg)" == y ]]; then pass "$name"
    else fail "$name" "argv=n config=y" "argv=$(key_in_argv) config=$(key_in_cfg) calls=$(wc -l < "$T/shim/argv" 2>/dev/null || echo 0)"; fi
    teardown
}
test_sites() {
    # fetch-iron-laws.sh sends no key since FR15: the decrypt CLI fetches the laws with its own credentials.
    check_site "oss-fetch-team-iron-laws.sh" bash "$HOOKS_DIR/oss-fetch-team-iron-laws.sh"
    check_site "oss-push-metrics.sh" bash "$HOOKS_DIR/oss-push-metrics.sh" '{"command":"build"}'
}

echo "Running oss-api-curl.sh tests..."
echo "======================================="
test_helper_key_on_stdin
test_helper_escapes_and_refuses
test_no_hook_puts_key_in_argv
test_sites
echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
