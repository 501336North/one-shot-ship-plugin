#!/bin/bash
# Tests for ConfigChange hook guard
#
# Usage: ./config-change-guard.test.sh
#
# Tests:
# 1. hooks.json should register ConfigChange handler
# 2. Should warn when hooks are disabled in config
# 3. Should warn when plugin is removed from config
# 4. Should not warn on benign config changes

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_JSON="$SCRIPT_DIR/../hooks.json"
GUARD_SCRIPT="$SCRIPT_DIR/../oss-config-change.sh"

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
# TEST 1: hooks.json should register ConfigChange handler
#
# @behavior Plugin watches for config changes that could break OSS
# @acceptance-criteria hooks.json has ConfigChange key
# =============================================================================
test_hooks_json_config_change() {
    local test_name="hooks.json should register ConfigChange handler"
    ((TESTS_RUN++))

    if [[ ! -f "$HOOKS_JSON" ]]; then
        fail "$test_name" "hooks.json exists" "file not found"
        return
    fi

    local has_key
    has_key=$(jq 'has("hooks") and (.hooks | has("ConfigChange"))' "$HOOKS_JSON" 2>/dev/null)

    if [[ "$has_key" == "true" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "ConfigChange key in hooks" "key not found"
    fi
}

# =============================================================================
# TEST 2: Should warn when hooks are disabled in config
#
# @behavior Disabling hooks breaks all OSS functionality
# @acceptance-criteria Output contains warning about hooks being disabled
# =============================================================================
test_warn_hooks_disabled() {
    local test_name="Should warn when hooks are disabled in config"
    ((TESTS_RUN++))

    if [[ ! -f "$GUARD_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found: $GUARD_SCRIPT"
        return
    fi

    local test_home
    test_home=$(mktemp -d)
    mkdir -p "$test_home/.claude"
    cat > "$test_home/.claude/settings.json" << 'EOF'
{
  "hooks": {
    "enabled": false
  }
}
EOF

    local result
    result=$(HOME="$test_home" "$GUARD_SCRIPT" 2>&1)

    rm -rf "$test_home"

    if echo "$result" | grep -qi "hooks.*disabled\|hooks.*off\|warning"; then
        pass "$test_name"
    else
        fail "$test_name" "warning about hooks disabled" "output: '$result'"
    fi
}

# =============================================================================
# TEST 3: Should warn when plugin is removed from config
#
# @behavior Removing the plugin breaks all OSS commands
# @acceptance-criteria Output contains warning about missing plugin
# =============================================================================
test_warn_plugin_removed() {
    local test_name="Should warn when plugin is removed from config"
    ((TESTS_RUN++))

    if [[ ! -f "$GUARD_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_home
    test_home=$(mktemp -d)
    mkdir -p "$test_home/.claude"
    cat > "$test_home/.claude/settings.json" << 'EOF'
{
  "plugins": []
}
EOF

    local result
    result=$(HOME="$test_home" "$GUARD_SCRIPT" 2>&1)

    rm -rf "$test_home"

    if echo "$result" | grep -qi "plugin.*removed\|plugin.*missing\|oss.*plugin\|warning"; then
        pass "$test_name"
    else
        fail "$test_name" "warning about plugin removed" "output: '$result'"
    fi
}

# =============================================================================
# TEST 4: Should not warn on benign config changes
#
# @behavior Normal settings don't trigger false alarms
# @acceptance-criteria No output when config is normal
# =============================================================================
test_no_warn_benign() {
    local test_name="Should not warn on benign config changes"
    ((TESTS_RUN++))

    if [[ ! -f "$GUARD_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_home
    test_home=$(mktemp -d)
    mkdir -p "$test_home/.claude"
    cat > "$test_home/.claude/settings.json" << 'EOF'
{
  "model": "claude-sonnet-4-6",
  "theme": "dark"
}
EOF

    local result
    result=$(HOME="$test_home" "$GUARD_SCRIPT" 2>&1)

    rm -rf "$test_home"

    if [[ -z "$result" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no output" "output: '$result'"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running config change guard tests..."
echo "======================================="

test_hooks_json_config_change
test_warn_hooks_disabled
test_warn_plugin_removed
test_no_warn_benign

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
