#!/bin/bash
# Tests for auto-format PostToolUse hook (Competitive Edge Pack - Feature A)
#
# @behavior Code is auto-formatted after Write/Edit tool use
# @business-rule Formatting never blocks edits; no-ops when no formatter found
#
# Usage: ./format-hook.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DETECT_SCRIPT="$SCRIPT_DIR/../oss-detect-formatter.sh"
FORMAT_SCRIPT="$SCRIPT_DIR/../oss-auto-format.sh"

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

setup_test_project() {
    local test_dir
    test_dir=$(mktemp -d)
    echo "$test_dir"
}

cleanup_test_env() {
    rm -rf "$1"
}

# =============================================================================
# TEST 1: Should detect prettier when .prettierrc exists
#
# @behavior Formatter detection finds prettier config
# @acceptance-criteria AC-001.3 - Output contains prettier command
# =============================================================================
test_detect_prettier() {
    local test_name="Should detect prettier when .prettierrc exists"
    ((TESTS_RUN++))

    if [[ ! -f "$DETECT_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found: $DETECT_SCRIPT"
        return
    fi

    local test_dir
    test_dir=$(setup_test_project)
    touch "$test_dir/.prettierrc"
    cat > "$test_dir/package.json" << 'EOF'
{ "scripts": { "format": "prettier --write ." } }
EOF

    local result
    result=$(cd "$test_dir" && "$DETECT_SCRIPT" 2>&1)

    if echo "$result" | grep -qi "prettier"; then
        pass "$test_name"
    else
        fail "$test_name" "output contains 'prettier'" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 2: Should detect biome when biome.json exists
#
# @behavior Formatter detection finds biome config
# @acceptance-criteria AC-001.3
# =============================================================================
test_detect_biome() {
    local test_name="Should detect biome when biome.json exists"
    ((TESTS_RUN++))

    if [[ ! -f "$DETECT_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_project)
    cat > "$test_dir/biome.json" << 'EOF'
{ "formatter": { "enabled": true } }
EOF

    local result
    result=$(cd "$test_dir" && "$DETECT_SCRIPT" 2>&1)

    if echo "$result" | grep -qi "biome"; then
        pass "$test_name"
    else
        fail "$test_name" "output contains 'biome'" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 3: Should detect format script from package.json
#
# @behavior Falls back to package.json scripts.format
# @acceptance-criteria AC-001.3
# =============================================================================
test_detect_package_json_format() {
    local test_name="Should detect format script from package.json"
    ((TESTS_RUN++))

    if [[ ! -f "$DETECT_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_project)
    # No .prettierrc, no biome.json — just a format script
    cat > "$test_dir/package.json" << 'EOF'
{ "scripts": { "format": "eslint --fix src/" } }
EOF

    local result
    result=$(cd "$test_dir" && "$DETECT_SCRIPT" 2>&1)

    if [[ -n "$result" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "non-empty output (detected format script)" "empty output"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 4: Should output empty when no formatter found
#
# @behavior No-op for projects without formatters
# @acceptance-criteria AC-001.2
# =============================================================================
test_no_formatter() {
    local test_name="Should output empty when no formatter found"
    ((TESTS_RUN++))

    if [[ ! -f "$DETECT_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_project)
    # Empty project — no config files at all

    local exit_code=0
    local result
    result=$(cd "$test_dir" && "$DETECT_SCRIPT" 2>&1) || exit_code=$?

    if [[ -z "$result" && $exit_code -eq 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "empty output, exit 0" "output: '$result', exit: $exit_code"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 5: Should skip formatting when OSS_AUTO_FORMAT=false
#
# @behavior Users can disable via environment variable
# @acceptance-criteria AC-001.4
# =============================================================================
test_disabled_via_env() {
    local test_name="Should skip formatting when OSS_AUTO_FORMAT=false"
    ((TESTS_RUN++))

    if [[ ! -f "$FORMAT_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found: $FORMAT_SCRIPT"
        return
    fi

    local test_dir
    test_dir=$(setup_test_project)
    touch "$test_dir/.prettierrc"

    local exit_code=0
    local result
    result=$(cd "$test_dir" && OSS_AUTO_FORMAT=false "$FORMAT_SCRIPT" 2>&1) || exit_code=$?

    # Should exit cleanly without running formatter
    if [[ $exit_code -eq 0 ]] && ! echo "$result" | grep -qi "formatting"; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0, no formatting output" "exit: $exit_code, output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 6: hooks.json should have PostToolUse entry for Write|Edit
#
# @behavior Hook configuration wires up auto-format
# @acceptance-criteria AC-001.1
# =============================================================================
test_hooks_json_has_posttooluse() {
    local test_name="hooks.json should have PostToolUse entry for Write|Edit"
    ((TESTS_RUN++))

    local hooks_file="$SCRIPT_DIR/../hooks.json"

    if [[ ! -f "$hooks_file" ]]; then
        fail "$test_name" "hooks.json exists" "file not found"
        return
    fi

    # Check for PostToolUse with Write|Edit matcher
    if command -v jq &>/dev/null; then
        local has_entry
        has_entry=$(jq '.hooks.PostToolUse[]? | select(.matcher == "Write|Edit")' "$hooks_file" 2>/dev/null)
        if [[ -n "$has_entry" ]]; then
            pass "$test_name"
        else
            fail "$test_name" "PostToolUse entry with Write|Edit matcher" "not found in hooks.json"
        fi
    else
        # Fallback: grep for the pattern
        if grep -q '"Write|Edit"' "$hooks_file"; then
            pass "$test_name"
        else
            fail "$test_name" "PostToolUse entry with Write|Edit matcher" "not found in hooks.json"
        fi
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running auto-format hook tests..."
echo "======================================="

test_detect_prettier
test_detect_biome
test_detect_package_json_format
test_no_formatter
test_disabled_via_env
test_hooks_json_has_posttooluse

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
