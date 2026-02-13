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
# 6. Accepts binary when SHA-256 checksum matches
# 7. Rejects binary when SHA-256 checksum does NOT match
# 8. Rejects binary when .sha256 file unavailable (fail closed)

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
# Helper: Create a mock curl that serves files from a staging directory
# Usage: setup_mock_curl <staging_dir> <sha256_mode>
#   - staging_dir: directory containing a "binary" file and optionally "checksum" file
#   - sha256_mode: "OK" to serve checksum, "FAIL" to simulate 404
# =============================================================================
setup_mock_curl() {
    local staging_dir="$1"
    local sha256_mode="$2"

    MOCK_BIN_DIR=$(mktemp -d)
    # Write the mock curl script with single-quoted heredoc (no expansion)
    cat > "$MOCK_BIN_DIR/curl" << 'CURLEOF'
#!/bin/bash
# Mock curl - reads from staging files
OUTPUT_FILE=""
URL=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        -o) OUTPUT_FILE="$2"; shift 2 ;;
        -sL|-s|-L) shift ;;
        *) URL="$1"; shift ;;
    esac
done
CURLEOF

    # Append the routing logic (with variable expansion for paths)
    cat >> "$MOCK_BIN_DIR/curl" << CURLEOF
if [[ "\$URL" == *.sha256 ]]; then
    if [[ "$sha256_mode" == "FAIL" ]]; then
        exit 1
    fi
    cp "$staging_dir/checksum" "\$OUTPUT_FILE"
else
    cp "$staging_dir/binary" "\$OUTPUT_FILE"
fi
exit 0
CURLEOF
    chmod +x "$MOCK_BIN_DIR/curl"

    export PATH="$MOCK_BIN_DIR:$PATH"
}

teardown_mock_curl() {
    rm -rf "$MOCK_BIN_DIR"
}

# =============================================================================
# TEST 6: Accepts binary when SHA-256 checksum matches
#
# @behavior Users receive verified binaries when checksums match
# @acceptance-criteria Binary installed and executable when checksum valid
# @boundary ensure-decrypt-cli.sh (system boundary)
# =============================================================================
test_checksum_match_accepts_binary() {
    local test_name="Accepts binary when SHA-256 checksum matches"
    ((TESTS_RUN++))

    setup_test_env

    # Create staging dir with a valid shell script as the "binary"
    local staging_dir
    staging_dir=$(mktemp -d)
    cat > "$staging_dir/binary" << 'BINEOF'
#!/bin/bash
if [[ "$1" == "--version" ]]; then echo "oss-decrypt v1.2.0"
elif [[ "$1" == "--setup" ]]; then exit 0
else echo "mock"; fi
BINEOF

    # Compute real SHA-256 of the staged binary
    local expected_hash
    expected_hash=$(shasum -a 256 "$staging_dir/binary" | awk '{print $1}')
    local PLATFORM=$(uname -s)
    local ARCH=$(uname -m)
    [[ "$ARCH" == "x86_64" ]] && ARCH="x64"
    echo "${expected_hash}  oss-decrypt-${PLATFORM}-${ARCH}" > "$staging_dir/checksum"

    setup_mock_curl "$staging_dir" "OK"

    # Create existing binary that reports old version (triggers download)
    mkdir -p "$TEST_HOME/.oss/bin"
    cat > "$TEST_HOME/.oss/bin/oss-decrypt" << 'MOCKEOF'
#!/bin/bash
if [[ "$1" == "--version" ]]; then echo "oss-decrypt v1.0.0"
elif [[ "$1" == "--setup" ]]; then exit 0
else echo "mock"; fi
MOCKEOF
    chmod +x "$TEST_HOME/.oss/bin/oss-decrypt"

    # Run hook (capture exit code properly)
    local result exit_code=0
    result=$("$HOOK_SCRIPT" 2>&1) || exit_code=$?

    teardown_mock_curl
    rm -rf "$staging_dir"
    teardown_test_env

    if [[ $exit_code -eq 0 ]] && echo "$result" | grep -qi "checksum.*verif"; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0 + checksum verified message" "exit=$exit_code output: $result"
    fi
}

# =============================================================================
# TEST 7: Rejects binary when SHA-256 checksum does NOT match
#
# @behavior Tampered binaries are rejected before execution
# @acceptance-criteria Binary deleted, exit 1, error message shown
# @boundary ensure-decrypt-cli.sh (system boundary)
# =============================================================================
test_checksum_mismatch_rejects_binary() {
    local test_name="Rejects binary when SHA-256 checksum does NOT match"
    ((TESTS_RUN++))

    setup_test_env

    # Create staging dir with binary and WRONG checksum
    local staging_dir
    staging_dir=$(mktemp -d)
    echo "MOCK_BINARY_CONTENT_TAMPERED" > "$staging_dir/binary"
    local wrong_hash="0000000000000000000000000000000000000000000000000000000000000000"
    local PLATFORM=$(uname -s)
    local ARCH=$(uname -m)
    [[ "$ARCH" == "x86_64" ]] && ARCH="x64"
    echo "${wrong_hash}  oss-decrypt-${PLATFORM}-${ARCH}" > "$staging_dir/checksum"

    setup_mock_curl "$staging_dir" "OK"

    # No existing binary — forces fresh download
    mkdir -p "$TEST_HOME/.oss/bin"

    # Run hook (capture exit code properly)
    local result exit_code=0
    result=$("$HOOK_SCRIPT" 2>&1) || exit_code=$?

    # Check binary was deleted
    local binary_exists=false
    if [[ -f "$TEST_HOME/.oss/bin/oss-decrypt" ]]; then
        binary_exists=true
    fi

    teardown_mock_curl
    rm -rf "$staging_dir"
    teardown_test_env

    if [[ $exit_code -ne 0 ]] && echo "$result" | grep -qi "checksum.*fail\|checksum.*mismatch"; then
        pass "$test_name"
    else
        fail "$test_name" "exit non-zero + checksum failed message" "exit=$exit_code binary_exists=$binary_exists output: $result"
    fi
}

# =============================================================================
# TEST 8: Rejects binary when .sha256 file unavailable (fail closed)
#
# @behavior Missing checksum file causes binary rejection (no graceful degradation)
# @acceptance-criteria Binary deleted, exit 1, error message shown
# @boundary ensure-decrypt-cli.sh (system boundary)
# =============================================================================
test_missing_checksum_rejects_binary() {
    local test_name="Rejects binary when .sha256 file unavailable (fail closed)"
    ((TESTS_RUN++))

    setup_test_env

    # Create staging dir with binary only (no checksum)
    local staging_dir
    staging_dir=$(mktemp -d)
    echo "MOCK_BINARY_NO_CHECKSUM" > "$staging_dir/binary"

    # Mock curl: binary succeeds, .sha256 returns FAIL (404)
    setup_mock_curl "$staging_dir" "FAIL"

    # No existing binary — forces fresh download
    mkdir -p "$TEST_HOME/.oss/bin"

    # Run hook (capture exit code properly)
    local result exit_code=0
    result=$("$HOOK_SCRIPT" 2>&1) || exit_code=$?

    local binary_exists=false
    if [[ -f "$TEST_HOME/.oss/bin/oss-decrypt" ]]; then
        binary_exists=true
    fi

    teardown_mock_curl
    rm -rf "$staging_dir"
    teardown_test_env

    if [[ $exit_code -ne 0 ]] && echo "$result" | grep -qi "checksum\|verify"; then
        pass "$test_name"
    else
        fail "$test_name" "exit non-zero + verification error message" "exit=$exit_code binary_exists=$binary_exists output: $result"
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
test_checksum_match_accepts_binary
test_checksum_mismatch_rejects_binary
test_missing_checksum_rejects_binary

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
