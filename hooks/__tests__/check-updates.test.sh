#!/bin/bash
# Tests for check-updates.sh (session-start update checker)
#
# @behavior Plugin/prompt updates are detected and user is notified via status bar
# @business-rule Notifications are informational only — no scary CTAs
#
# Usage: ./check-updates.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_UPDATES_SCRIPT="$SCRIPT_DIR/../check-updates.sh"

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
# Test helpers
# =============================================================================

setup_test_env() {
    local test_dir
    test_dir=$(mktemp -d)

    # Create mock config dir
    mkdir -p "$test_dir/config"
    mkdir -p "$test_dir/plugin"

    # Create mock plugin.json
    cat > "$test_dir/plugin/plugin.json" << 'EOF'
{
  "name": "oss-dev-workflow",
  "version": "2.0.45"
}
EOF

    # Create mock update-state.json with old version
    cat > "$test_dir/config/update-state.json" << 'EOF'
{
  "lastPluginVersion": "2.0.44",
  "lastCheckedAt": "2026-02-25T00:00:00Z",
  "manifestVersion": 0,
  "manifestHashes": {},
  "promptSignatures": {}
}
EOF

    # Create mock settings.json
    cat > "$test_dir/config/settings.json" << 'EOF'
{
  "notifications": {
    "updates": true
  }
}
EOF

    echo "$test_dir"
}

cleanup_test_env() {
    rm -rf "$1"
}

# =============================================================================
# TEST 1: Should detect plugin version change and output notification
#
# @behavior User sees version change notification on session start
# @acceptance-criteria Output contains version string with new version number
# =============================================================================
test_detect_plugin_version_change() {
    local test_name="Should detect plugin version change and output notification"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found: $CHECK_UPDATES_SCRIPT"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_SKIP_MANIFEST=1 \
             "$CHECK_UPDATES_SCRIPT" 2>&1)

    if echo "$result" | grep -q "2.0.45"; then
        pass "$test_name"
    else
        fail "$test_name" "output contains '2.0.45'" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 2: Should not notify when plugin version unchanged
#
# @behavior Silent when nothing has changed
# @acceptance-criteria No notification output when version matches cached
# =============================================================================
test_no_notify_when_unchanged() {
    local test_name="Should not notify when plugin version unchanged"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Set cached version to match current
    cat > "$test_dir/config/update-state.json" << 'EOF'
{
  "lastPluginVersion": "2.0.45",
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
             "$CHECK_UPDATES_SCRIPT" 2>&1)

    if [[ -z "$result" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no output" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 3: Should detect manifest hash changes and count updated prompts
#
# @behavior User sees prompt update count on session start
# @acceptance-criteria Output contains count of changed prompts
# =============================================================================
test_detect_manifest_changes() {
    local test_name="Should detect manifest hash changes and count updated prompts"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Set cached version to match (no plugin change)
    # But give it old manifest hashes
    cat > "$test_dir/config/update-state.json" << 'EOF'
{
  "lastPluginVersion": "2.0.45",
  "lastCheckedAt": "2026-02-25T00:00:00Z",
  "manifestVersion": 1,
  "manifestHashes": {
    "workflows/build": "oldhash1",
    "workflows/plan": "oldhash2",
    "commands/adr": "samehash"
  },
  "promptSignatures": {}
}
EOF

    # Create a mock manifest response with changed hashes
    cat > "$test_dir/manifest.json" << 'EOF'
{
  "version": 2,
  "generatedAt": "2026-02-25T05:00:00Z",
  "algorithm": "sha256",
  "signing": "ed25519",
  "prompts": {
    "workflows/build": {"hash": "newhash1", "size": 100},
    "workflows/plan": {"hash": "newhash2", "size": 200},
    "commands/adr": {"hash": "samehash", "size": 50}
  },
  "signature": "mocksig"
}
EOF

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_MOCK_MANIFEST="$test_dir/manifest.json" \
             "$CHECK_UPDATES_SCRIPT" 2>&1)

    # Should mention 2 prompts changed
    if echo "$result" | grep -q "2 prompts"; then
        pass "$test_name"
    else
        fail "$test_name" "output mentions '2 prompts'" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 4: Should combine notification when both plugin + prompts changed
#
# @behavior Single combined notification when both change simultaneously
# @acceptance-criteria Output contains both version AND prompt count
# =============================================================================
test_combined_notification() {
    local test_name="Should combine notification when both plugin + prompts changed"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Old plugin version + old hashes
    cat > "$test_dir/config/update-state.json" << 'EOF'
{
  "lastPluginVersion": "2.0.44",
  "lastCheckedAt": "2026-02-25T00:00:00Z",
  "manifestVersion": 1,
  "manifestHashes": {
    "workflows/build": "oldhash1"
  },
  "promptSignatures": {}
}
EOF

    cat > "$test_dir/manifest.json" << 'EOF'
{
  "version": 2,
  "generatedAt": "2026-02-25T05:00:00Z",
  "algorithm": "sha256",
  "signing": "ed25519",
  "prompts": {
    "workflows/build": {"hash": "newhash1", "size": 100}
  },
  "signature": "mocksig"
}
EOF

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_MOCK_MANIFEST="$test_dir/manifest.json" \
             "$CHECK_UPDATES_SCRIPT" 2>&1)

    # Should contain BOTH version and prompt count in one message
    if echo "$result" | grep -q "2.0.45" && echo "$result" | grep -q "prompt"; then
        pass "$test_name"
    else
        fail "$test_name" "output contains version AND prompt info" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 5: Should respect notifications.updates=false setting
#
# @behavior User can disable update notifications via settings
# @acceptance-criteria No output when notifications.updates is false
# =============================================================================
test_respect_settings_disabled() {
    local test_name="Should respect notifications.updates=false setting"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Disable notifications
    cat > "$test_dir/config/settings.json" << 'EOF'
{
  "notifications": {
    "updates": false
  }
}
EOF

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_SKIP_MANIFEST=1 \
             "$CHECK_UPDATES_SCRIPT" 2>&1)

    if [[ -z "$result" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no output (disabled)" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 6: Should complete quickly even if manifest fetch fails
#
# @behavior Network failure doesn't block session start
# @acceptance-criteria Script exits 0 within timeout, no notification
# =============================================================================
test_handles_manifest_failure() {
    local test_name="Should complete quickly even if manifest fetch fails"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Same version (no plugin change), no mock manifest (will fail)
    cat > "$test_dir/config/update-state.json" << 'EOF'
{
  "lastPluginVersion": "2.0.45",
  "lastCheckedAt": "2026-02-25T00:00:00Z",
  "manifestVersion": 0,
  "manifestHashes": {},
  "promptSignatures": {}
}
EOF

    local start_time exit_code=0
    start_time=$(date +%s)
    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_MANIFEST_URL="http://localhost:99999/nonexistent" \
             "$CHECK_UPDATES_SCRIPT" 2>&1) || exit_code=$?
    local end_time
    end_time=$(date +%s)

    local elapsed=$((end_time - start_time))

    if [[ $exit_code -eq 0 && $elapsed -lt 5 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0, < 5s" "exit=$exit_code, elapsed=${elapsed}s, output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 7: Should initialize state file on first run without notification
#
# @behavior First run caches state silently, no "update" notification
# @acceptance-criteria State file created, no notification output
# =============================================================================
test_first_run_silent() {
    local test_name="Should initialize state file on first run without notification"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Remove state file (first run)
    rm -f "$test_dir/config/update-state.json"

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_SKIP_MANIFEST=1 \
             "$CHECK_UPDATES_SCRIPT" 2>&1)

    # Should create state file but not notify
    if [[ -f "$test_dir/config/update-state.json" && -z "$result" ]]; then
        pass "$test_name"
    else
        local file_exists="false"
        [[ -f "$test_dir/config/update-state.json" ]] && file_exists="true"
        fail "$test_name" "state file created, no output" "file_exists=$file_exists, output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 8: Should read releaseNote from plugin.json
#
# @behavior Plugin version notification includes release note text
# @acceptance-criteria Notification contains releaseNote from plugin.json
# =============================================================================
test_release_note() {
    local test_name="Should read releaseNote from plugin.json"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Add releaseNote to plugin.json
    cat > "$test_dir/plugin/plugin.json" << 'EOF'
{
  "name": "oss-dev-workflow",
  "version": "2.0.45",
  "releaseNote": "faster TDD cycles"
}
EOF

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_SKIP_MANIFEST=1 \
             "$CHECK_UPDATES_SCRIPT" 2>&1)

    if echo "$result" | grep -q "faster TDD cycles"; then
        pass "$test_name"
    else
        fail "$test_name" "output contains 'faster TDD cycles'" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running check-updates tests..."
echo "======================================="

test_detect_plugin_version_change
test_no_notify_when_unchanged
test_detect_manifest_changes
test_combined_notification
test_respect_settings_disabled
test_handles_manifest_failure
test_first_run_silent
test_release_note

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
