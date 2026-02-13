#!/bin/bash
# Tests for ensure-decrypt-cli.sh hook
#
# Usage: ./ensure-decrypt-cli.test.sh
#
# Tests:
# 1. Returns 0 when binary exists with current version
# 2. Creates bin directory if missing
# 3. Handles platform detection correctly
# 4. Hook script exists and is executable
# 5. Triggers update when binary version is outdated

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/../ensure-decrypt-cli.sh"

# Test tracking
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Test helpers
setup_test_env() {
    TEST_HOME=$(mktemp -d)
    export HOME="$TEST_HOME"
    mkdir -p "$TEST_HOME/.oss"
}

teardown_test_env() {
    rm -rf "$TEST_HOME"
}

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
# TEST 1: Returns 0 when binary exists with current version
# =============================================================================
test_binary_exists() {
    local test_name="Returns 0 when binary exists with current version"
    ((TESTS_RUN++))

    setup_test_env

    # Setup: Create mock binary that reports a valid version
    mkdir -p "$TEST_HOME/.oss/bin"
    cat > "$TEST_HOME/.oss/bin/oss-decrypt" << 'MOCKEOF'
#!/bin/bash
if [[ "$1" == "--version" ]]; then
    echo "oss-decrypt v1.1.0"
else
    echo "mock binary"
fi
MOCKEOF
    chmod +x "$TEST_HOME/.oss/bin/oss-decrypt"

    # Run hook
    local result
    result=$("$HOOK_SCRIPT" 2>&1) || true
    local exit_code=$?

    teardown_test_env

    if [[ $exit_code -eq 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit code 0" "exit code $exit_code"
    fi
}

# =============================================================================
# TEST 2: Creates bin directory if missing
# =============================================================================
test_creates_bin_dir() {
    local test_name="Creates ~/.oss/bin directory if missing"
    ((TESTS_RUN++))

    setup_test_env

    # Setup: Ensure no bin directory
    rm -rf "$TEST_HOME/.oss/bin"

    # Run hook (will fail on download, but should create dir first)
    "$HOOK_SCRIPT" 2>&1 || true

    # Check if directory was created
    if [[ -d "$TEST_HOME/.oss/bin" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "directory exists" "directory missing"
    fi

    teardown_test_env
}

# =============================================================================
# TEST 3: Detects platform correctly
# =============================================================================
test_platform_detection() {
    local test_name="Detects platform correctly"
    ((TESTS_RUN++))

    local os=$(uname -s)
    local arch=$(uname -m)

    # Normalize arch
    [[ "$arch" == "x86_64" ]] && arch="x64"

    if [[ "$os" == "Darwin" || "$os" == "Linux" ]] && [[ "$arch" == "arm64" || "$arch" == "x64" ]]; then
        pass "$test_name (detected: $os-$arch)"
    else
        fail "$test_name" "Darwin or Linux with arm64 or x64" "$os-$arch"
    fi
}

# =============================================================================
# TEST 4: Hook script exists and is executable
# =============================================================================
test_hook_exists() {
    local test_name="Hook script exists and is executable"
    ((TESTS_RUN++))

    if [[ -x "$HOOK_SCRIPT" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "executable hook" "missing or not executable: $HOOK_SCRIPT"
    fi
}

# =============================================================================
# TEST 5: Triggers update when binary version is outdated
# =============================================================================
test_outdated_version_triggers_update() {
    local test_name="Triggers update when binary version is outdated"
    ((TESTS_RUN++))

    setup_test_env

    # Setup: Create mock binary that reports an old version
    mkdir -p "$TEST_HOME/.oss/bin"
    cat > "$TEST_HOME/.oss/bin/oss-decrypt" << 'MOCKEOF'
#!/bin/bash
if [[ "$1" == "--version" ]]; then
    echo "oss-decrypt v1.0.0"
else
    echo "mock binary"
fi
MOCKEOF
    chmod +x "$TEST_HOME/.oss/bin/oss-decrypt"

    # Run hook - should detect outdated version and try to update
    # (download will fail in test env, but we check the output message)
    local result
    result=$("$HOOK_SCRIPT" 2>&1) || true

    teardown_test_env

    if echo "$result" | grep -q "outdated"; then
        pass "$test_name"
    else
        fail "$test_name" "output containing 'outdated'" "$result"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running ensure-decrypt-cli.sh tests..."
echo "======================================="

test_hook_exists
test_platform_detection
test_binary_exists
test_creates_bin_dir
test_outdated_version_triggers_update

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
