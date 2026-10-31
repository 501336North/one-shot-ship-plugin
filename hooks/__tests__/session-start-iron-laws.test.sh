#!/bin/bash
# Tests for oss-session-start.sh Iron Laws sync integration
#
# Usage: ./session-start-iron-laws.test.sh
#
# Tests:
# 1. Session start dispatches the refresh in the background when an API key exists
# 2. Session start does not start the refresh without an API key
# 2b. The subscription check keeps the API key off curl argv
# 3. Session-start should copy sync script to ~/.oss/hooks/

set -uo pipefail
# The hooks read the API key and URL from $OSS_CONFIG_DIR/config.json: a developer's exported
# override must not lead them to the real key and the real API (T19).
unset OSS_CONFIG_DIR OSS_MANIFEST_URL

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/run-capped.sh"   # the one time cap a test may use (T49)
# HOOKS_UNDER_TEST=/path/to/hooks-copy runs these tests against a copy (mutants).
SESSION_START_SCRIPT="${HOOKS_UNDER_TEST:-$SCRIPT_DIR/..}/oss-session-start.sh"

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

# Fixture for behavioural session-start tests: a temp HOME, a temp project, a curl shim that
# records argv and --config stdin, and a fake plugin root whose oss-iron-laws-sync.sh is a
# recorder stub that prints to stdout and takes 6s (an API that never answers).
# Both stubs are made and warmed once (macOS scans each new executable on its first exec, 0.3-60 s)
# and symlinked into each case; they write into the current case's dir, $SS_T.
source "$SCRIPT_DIR/lib/warm-stub.sh"
KS=$(mktemp -d); KS=$(cd "$KS" && pwd -P)
trap 'rm -rf "$KS"' EXIT
# Session start runs under an alias (lib/session-start-alias.sh): an outside `pkill -f oss-session-start` misses it (T48).
source "$SCRIPT_DIR/lib/session-start-alias.sh"
SS_HOOK=$(session_start_alias "$(dirname "$SESSION_START_SCRIPT")" "$KS/ss-alias/hooks") || { echo "✗ FAIL: session start alias"; exit 1; }
STUBS_WARM=y
warm_stub "$KS/bin/curl" "$(cat << 'SHIM'
S="$SS_T/shim"
printf '%s\n' "$*" >> "$S/argv"
prev=""
for a in "$@"; do
    if [[ ( "$prev" == "--config" || "$prev" == "-K" ) && "$a" == "-" ]]; then cat >> "$S/stdin"; fi
    prev="$a"
done
printf '{"status":"active"}'
SHIM
)" || STUBS_WARM=n
warm_stub "$KS/sync.sh" "$(cat << 'STUB'
printf '%s|%s\n' "$$" "$*" > "$SS_T/sync-started"
echo "SYNC STDOUT LEAK"
sleep 6
touch "$SS_T/sync-finished"
STUB
)" || STUBS_WARM=n
if [[ $STUBS_WARM != y ]]; then echo "✗ FAIL: stub warm-up — a stub did not run"; exit 1; fi
ss_setup() {
    T=$(mktemp -d)
    mkdir -p "$T/home/.oss" "$T/proj" "$T/shim" "$T/root/hooks"
    ln -s "$KS/bin" "$T/bin"
    ln -s "$KS/sync.sh" "$T/root/hooks/oss-iron-laws-sync.sh"
}
ss_run() { # runs the real session start (health checks ON, so the sync path is live)
    (cd "$T/proj" && SS_T="$T" HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/root" CLAUDE_PROJECT_DIR="$T/proj" \
        OSS_SKIP_HEALTH_CHECK= OSS_TEST_CC_VERSION=2.1.99 PATH="$T/bin:$PATH" \
        run_capped 30 bash "$SS_HOOK" </dev/null 2>&1)
}
ss_teardown() {
    local pid; pid=$(cut -d'|' -f1 "$T/sync-started" 2>/dev/null)
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null
    rm -rf "$T"
}
wait_for_file() { local i; for i in $(seq 1 50); do [[ -e "$1" ]] && return 0; sleep 0.1; done; return 1; }

# =============================================================================
# TEST 1: Session start dispatches the Iron Laws refresh in the background
#
# @behavior With an API key, session start starts the refresh (refresh mode, no --install)
#           and returns without waiting for it or showing its output.
# @business-rule A slow or dead API must never delay a customer's session start.
# =============================================================================
test_calls_sync_with_api_key() {
    local test_name="Session start dispatches the refresh in the background (never waits for it)"
    ((TESTS_RUN++))
    ss_setup
    printf '{"apiKey": "fake-key-ss-0001"}\n' > "$T/home/.oss/config.json"
    local out; out=$(ss_run)
    local finished_at_return=n; [[ -e "$T/sync-finished" ]] && finished_at_return=y
    local started=n args=""; wait_for_file "$T/sync-started" && started=y && args=$(cut -d'|' -f2 "$T/sync-started")
    local leaked=n; [[ "$out" == *"SYNC STDOUT LEAK"* ]] && leaked=y
    if [[ "$started" == y && "$finished_at_return" == n && "$leaked" == n && -z "$args" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "started, not awaited, output discarded, no flags" "started=$started finished_at_return=$finished_at_return leaked=$leaked args=$args"
    fi
    ss_teardown
}

# =============================================================================
# TEST 2: Session start does not start the refresh without an API key
#
# @behavior No refresh is attempted without authentication
# @business-rule Don't make API calls without credentials
# =============================================================================
test_skips_sync_without_api_key() {
    local test_name="Session start does not start the refresh without an API key"
    ((TESTS_RUN++))
    ss_setup
    printf '{}\n' > "$T/home/.oss/config.json"
    # Fd 3 is a second writer on the substitution's pipe: the hook and every job it starts (the
    # nohup'd refresh redirects only fds 0-2) inherit it, so $(...) returns only when all of them
    # have exited. A refresh started by mistake, however slow, has written sync-started by then.
    local _wait; _wait=$(ss_run 3>&1 >/dev/null)
    if [[ ! -e "$T/sync-started" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no refresh started" "started"
    fi
    ss_teardown
}

# =============================================================================
# TEST 2b: The subscription check never puts the API key on curl's command line
#
# @behavior Session start authenticates via the shared helper (key on curl's stdin)
# @business-rule Any local user can read process argv with ps; the key must not be there
# =============================================================================
test_subscription_check_key_off_argv() {
    local test_name="Session start subscription check keeps the API key off curl argv"
    ((TESTS_RUN++))
    ss_setup
    printf '{"apiKey": "fake-key-ss-0002"}\n' > "$T/home/.oss/config.json"
    local out; out=$(ss_run)
    local in_argv=n in_cfg=n
    grep -qF "fake-key-ss-0002" "$T/shim/argv" 2>/dev/null && in_argv=y
    grep -qF "Authorization: Bearer fake-key-ss-0002" "$T/shim/stdin" 2>/dev/null && in_cfg=y
    if [[ "$in_argv" == n && "$in_cfg" == y && "$out" == *"Ready (active)"* ]]; then
        pass "$test_name"
    else
        fail "$test_name" "argv=n config=y status active" "argv=$in_argv config=$in_cfg out=$(echo "$out" | grep -i ready)"
    fi
    ss_teardown
}

# =============================================================================
# TEST 3: Session-start should copy sync script to ~/.oss/hooks/
#
# @behavior Sync script available for skills that run outside plugin context
# @business-rule Ensure hooks are accessible from ~/.oss/hooks/
# =============================================================================
test_copies_sync_to_oss_hooks() {
    local test_name="Session-start should copy sync script to ~/.oss/hooks/"
    ((TESTS_RUN++))

    # Behavioural: run session start against a clean HOME and check the script really lands there.
    # (A grep of HOOKS_TO_COPY passed for 2.0.51-2.0.83 while the script itself was never committed.)
    local tmp_home
    tmp_home=$(mktemp -d)
    HOME="$tmp_home" CLAUDE_PLUGIN_ROOT="$SCRIPT_DIR/../.." OSS_SKIP_HEALTH_CHECK=1 \
        bash "$SS_HOOK" >/dev/null 2>&1 </dev/null
    local copied="$tmp_home/.oss/hooks/oss-iron-laws-sync.sh"
    if [[ -x "$copied" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "executable ~/.oss/hooks/oss-iron-laws-sync.sh after session start" "exists=$([[ -f $copied ]] && echo y || echo n)"
    fi
    rm -rf "$tmp_home"
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running session-start Iron Laws integration tests..."
echo "======================================="

test_calls_sync_with_api_key
test_skips_sync_without_api_key
test_subscription_check_key_off_argv
test_copies_sync_to_oss_hooks

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
