#!/bin/bash
# Tests for CC version check in oss-session-start.sh
#
# Usage: ./version-check.test.sh
#
# Tests:
# 1. Should warn when CC version is below 2.1.50
# 2. Should not warn when CC version is 2.1.50 or above
# 3. Should handle missing claude CLI gracefully
# 4. Should parse version correctly from "X.Y.Z (Claude Code)" format

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_CHECK_SCRIPT="$SCRIPT_DIR/../oss-version-check.sh"

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
# TEST 1: Should warn when CC version is below 2.1.50
#
# @behavior Users on old CC versions see upgrade recommendation
# @acceptance-criteria Output contains warning when version < 2.1.50
# =============================================================================
test_warn_below_minimum() {
    local test_name="Should warn when CC version is below 2.1.50"
    ((TESTS_RUN++))

    if [[ ! -f "$VERSION_CHECK_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found: $VERSION_CHECK_SCRIPT"
        return
    fi

    # Create mock claude that reports old version
    local mock_dir
    mock_dir=$(mktemp -d)
    cat > "$mock_dir/claude" << 'EOF'
#!/bin/bash
echo "2.1.49 (Claude Code)"
EOF
    chmod +x "$mock_dir/claude"

    local result
    result=$(PATH="$mock_dir:$PATH" "$VERSION_CHECK_SCRIPT" 2>&1)

    rm -rf "$mock_dir"

    if echo "$result" | grep -qi "recommend\|upgrade\|v2.1.50"; then
        pass "$test_name"
    else
        fail "$test_name" "warning about v2.1.50" "output: '$result'"
    fi
}

# =============================================================================
# TEST 2: Should not warn when CC version is 2.1.50 or above
#
# @behavior Users on current CC version see no warning
# @acceptance-criteria No output when version >= 2.1.50
# =============================================================================
test_no_warn_at_or_above() {
    local test_name="Should not warn when CC version is 2.1.50 or above"
    ((TESTS_RUN++))

    if [[ ! -f "$VERSION_CHECK_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    # Create mock claude that reports current version
    local mock_dir
    mock_dir=$(mktemp -d)
    cat > "$mock_dir/claude" << 'EOF'
#!/bin/bash
echo "2.1.50 (Claude Code)"
EOF
    chmod +x "$mock_dir/claude"

    local result
    result=$(PATH="$mock_dir:$PATH" "$VERSION_CHECK_SCRIPT" 2>&1)

    rm -rf "$mock_dir"

    if [[ -z "$result" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no output" "output: '$result'"
    fi
}

# =============================================================================
# TEST 3: Should handle missing claude CLI gracefully
#
# @behavior Missing CLI doesn't crash session start
# @acceptance-criteria Script exits 0 with no warning when claude not found
# =============================================================================
test_missing_cli() {
    local test_name="Should handle missing claude CLI gracefully"
    ((TESTS_RUN++))

    if [[ ! -f "$VERSION_CHECK_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    # Use empty PATH to ensure claude is not found
    local mock_dir
    mock_dir=$(mktemp -d)

    local result exit_code=0
    result=$(PATH="$mock_dir" "$VERSION_CHECK_SCRIPT" 2>&1) || exit_code=$?

    rm -rf "$mock_dir"

    if [[ $exit_code -eq 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0" "exit $exit_code, output: '$result'"
    fi
}

# =============================================================================
# TEST 4: Should parse version correctly from various formats
#
# @behavior Version parsing handles different claude --version outputs
# @acceptance-criteria Correctly identifies v2.2.0 as above minimum
# =============================================================================
test_parse_newer_version() {
    local test_name="Should parse version correctly (2.2.0 is above minimum)"
    ((TESTS_RUN++))

    if [[ ! -f "$VERSION_CHECK_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local mock_dir
    mock_dir=$(mktemp -d)
    cat > "$mock_dir/claude" << 'EOF'
#!/bin/bash
echo "2.2.0 (Claude Code)"
EOF
    chmod +x "$mock_dir/claude"

    local result
    result=$(PATH="$mock_dir:$PATH" "$VERSION_CHECK_SCRIPT" 2>&1)

    rm -rf "$mock_dir"

    if [[ -z "$result" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no output (version is above minimum)" "output: '$result'"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running version check tests..."
echo "======================================="

test_warn_below_minimum
test_no_warn_at_or_above
test_missing_cli
test_parse_newer_version

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
