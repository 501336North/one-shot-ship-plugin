#!/bin/bash
# Tests for oss-changelog.sh (changelog display hook)
#
# @behavior Users can see what changed since their last session
# @business-rule Missing state gracefully shows current baseline
#
# Usage: ./changelog.test.sh

set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# HOOKS_UNDER_TEST=/path/to/hooks-copy runs these tests against a copy (mutants).
CHANGELOG_SCRIPT="${HOOKS_UNDER_TEST:-$SCRIPT_DIR/..}/oss-changelog.sh"
# shellcheck source=lib/run-capped.sh
source "$SCRIPT_DIR/lib/run-capped.sh"

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

setup_test_env() {
    local test_dir
    test_dir=$(mktemp -d)
    mkdir -p "$test_dir/config"
    mkdir -p "$test_dir/plugin"

    cat > "$test_dir/plugin/plugin.json" << 'EOF'
{
  "name": "oss-dev-workflow",
  "version": "2.0.45"
}
EOF

    echo "$test_dir"
}

cleanup_test_env() {
    rm -rf "$1"
}

# =============================================================================
# TEST 1: Should display changed prompts when manifest differs from cached
#
# @behavior User sees list of updated prompts
# @acceptance-criteria Output lists changed prompt names
# =============================================================================
test_display_changed_prompts() {
    local test_name="Should display changed prompts when manifest differs from cached"
    ((TESTS_RUN++))

    if [[ ! -f "$CHANGELOG_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found: $CHANGELOG_SCRIPT"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Cached state with old hashes
    cat > "$test_dir/config/update-state.json" << 'EOF'
{
  "lastPluginVersion": "2.0.45",
  "lastCheckedAt": "2026-02-25T00:00:00Z",
  "manifestVersion": 1,
  "manifestHashes": {
    "workflows/build": "oldhash1",
    "workflows/plan": "samehash",
    "commands/adr": "oldhash2"
  },
  "promptSignatures": {}
}
EOF

    # Mock manifest with some changed hashes
    cat > "$test_dir/manifest.json" << 'EOF'
{
  "version": 2,
  "generatedAt": "2026-02-25T05:00:00Z",
  "algorithm": "sha256",
  "signing": "ed25519",
  "prompts": {
    "workflows/build": {"hash": "newhash1", "size": 100},
    "workflows/plan": {"hash": "samehash", "size": 200},
    "commands/adr": {"hash": "newhash2", "size": 50}
  },
  "signature": "mocksig"
}
EOF

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_MOCK_MANIFEST="$test_dir/manifest.json" \
             "$CHANGELOG_SCRIPT" 2>&1)

    # Should list the changed prompts
    if echo "$result" | grep -q "workflows/build" && echo "$result" | grep -q "commands/adr"; then
        pass "$test_name"
    else
        fail "$test_name" "output lists workflows/build and commands/adr" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 2: Should display plugin version change when version differs
#
# @behavior User sees version upgrade line
# @acceptance-criteria Output shows old → new version
# =============================================================================
test_display_version_change() {
    local test_name="Should display plugin version change when version differs"
    ((TESTS_RUN++))

    if [[ ! -f "$CHANGELOG_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    cat > "$test_dir/config/update-state.json" << 'EOF'
{
  "lastPluginVersion": "2.0.44",
  "lastCheckedAt": "2026-02-25T00:00:00Z",
  "manifestVersion": 0,
  "manifestHashes": {},
  "promptSignatures": {}
}
EOF

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_SKIP_MANIFEST=1 \
             "$CHANGELOG_SCRIPT" 2>&1)

    # Should show version transition
    if echo "$result" | grep -q "2.0.44" && echo "$result" | grep -q "2.0.45"; then
        pass "$test_name"
    else
        fail "$test_name" "output shows 2.0.44 → 2.0.45" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 3: Should display "No updates" when nothing changed
#
# @behavior User sees up-to-date message when everything matches
# @acceptance-criteria Output contains "No updates" or similar
# =============================================================================
test_no_updates() {
    local test_name="Should display 'No updates' when nothing changed"
    ((TESTS_RUN++))

    if [[ ! -f "$CHANGELOG_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Everything matches
    cat > "$test_dir/config/update-state.json" << 'EOF'
{
  "lastPluginVersion": "2.0.45",
  "lastCheckedAt": "2026-02-25T00:00:00Z",
  "manifestVersion": 1,
  "manifestHashes": {
    "workflows/build": "hash1"
  },
  "promptSignatures": {}
}
EOF

    cat > "$test_dir/manifest.json" << 'EOF'
{
  "version": 1,
  "generatedAt": "2026-02-25T05:00:00Z",
  "algorithm": "sha256",
  "signing": "ed25519",
  "prompts": {
    "workflows/build": {"hash": "hash1", "size": 100}
  },
  "signature": "mocksig"
}
EOF

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_MOCK_MANIFEST="$test_dir/manifest.json" \
             "$CHANGELOG_SCRIPT" 2>&1)

    if echo "$result" | grep -qi "no updates\|up to date"; then
        pass "$test_name"
    else
        fail "$test_name" "output contains 'No updates' or 'up to date'" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 4: Should handle missing update-state.json gracefully
#
# @behavior First-time users see baseline, no crash
# @acceptance-criteria Script exits 0 with informational output
# =============================================================================
test_missing_state_file() {
    local test_name="Should handle missing update-state.json gracefully"
    ((TESTS_RUN++))

    if [[ ! -f "$CHANGELOG_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # No state file
    local exit_code=0
    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_SKIP_MANIFEST=1 \
             "$CHANGELOG_SCRIPT" 2>&1) || exit_code=$?

    if [[ $exit_code -eq 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0" "exit $exit_code, output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# T53b: the state file is only read as a regular file
#
# @behavior A symlink or a FIFO at ~/.oss/update-state.json counts as no state: /oss:changelog shows the
#           first-run baseline, never what the link points to, never hangs and never prints an error.
# @business-rule State in ~/.oss is trusted only as a regular file (oss_is_regular, T32/T53).
# =============================================================================

# run_odd_state DIR: one capped run against DIR's sandbox (HOME, config, plugin.json and a local manifest that
# names the linked prompt). Sets RC, OUT (stdout) and ERR (stderr).
run_odd_state() {
    local d="$1"
    printf '{"prompts":{"linked/prompt":{"hash":"new"}}}\n' > "$d/manifest.json"
    mkdir -p "$d/home"
    run_capped 10 env HOME="$d/home" OSS_CONFIG_DIR="$d/config" OSS_PLUGIN_JSON="$d/plugin/plugin.json" \
        OSS_MOCK_MANIFEST="$d/manifest.json" "$CHANGELOG_SCRIPT" > "$d/out" 2> "$d/err" </dev/null
    RC=$?
    OUT=$(cat "$d/out"); ERR=$(cat "$d/err")
}
# The baseline and none of the linked values: no version, no check time, no prompt from the link.
shows_baseline_only() {
    [[ $RC == 0 && -z "$ERR" && "$OUT" == *"Plugin: v2.0.45 (first run — no previous state)"* \
       && "$OUT" != *"9.9.9-linked"* && "$OUT" != *"LINKED-CHECK-TIME"* && "$OUT" != *"Last checked"* \
       && "$OUT" != *"linked/prompt"* ]]
}

test_state_symlink() {
    local test_name="A symlinked update-state.json is never read: first-run baseline, no linked values (T53b)"
    ((TESTS_RUN++))
    local d; d=$(setup_test_env); mkdir -p "$d/outside"
    printf '%s\n' '{"lastPluginVersion":"9.9.9-linked","lastCheckedAt":"LINKED-CHECK-TIME","manifestHashes":{"linked/prompt":"old"}}' \
        > "$d/outside/state.json"
    ln -s "$d/outside/state.json" "$d/config/update-state.json"
    run_odd_state "$d"
    if shows_baseline_only; then
        pass "$test_name"
    else
        fail "$test_name" "rc=0, first-run baseline, nothing from the link, no stderr" "rc=$RC err='$ERR' out='$OUT'"
    fi
    cleanup_test_env "$d"
}

test_state_fifo() {
    local test_name="A FIFO at update-state.json: no hang, first-run baseline, no error (T53b)"
    ((TESTS_RUN++))
    local d; d=$(setup_test_env)
    mkfifo "$d/config/update-state.json"
    run_odd_state "$d"
    if shows_baseline_only; then
        pass "$test_name"
    else
        fail "$test_name" "rc=0 (124/125 = hung), first-run baseline, no stderr" "rc=$RC err='$ERR' out='$OUT'"
    fi
    cleanup_test_env "$d"
}

test_no_helper() {
    local test_name="Without oss-api-curl.sh beside it: no error, a regular state counts as none (T53b)"
    ((TESTS_RUN++))
    local d; d=$(setup_test_env); mkdir -p "$d/hooks"
    cp "$CHANGELOG_SCRIPT" "$d/hooks/"
    printf '%s\n' '{"lastPluginVersion":"9.9.9-linked","lastCheckedAt":"LINKED-CHECK-TIME"}' > "$d/config/update-state.json"
    local saved="$CHANGELOG_SCRIPT"; CHANGELOG_SCRIPT="$d/hooks/oss-changelog.sh"
    run_odd_state "$d"; CHANGELOG_SCRIPT="$saved"
    if shows_baseline_only; then
        pass "$test_name"
    else
        fail "$test_name" "rc=0, first-run baseline, no stderr" "rc=$RC err='$ERR' out='$OUT'"
    fi
    cleanup_test_env "$d"
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running changelog tests..."
echo "======================================="

test_display_changed_prompts
test_display_version_change
test_no_updates
test_missing_state_file
test_state_symlink
test_state_fifo
test_no_helper

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
