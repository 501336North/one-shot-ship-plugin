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
# 9. Installs the Linux-arm64 binary on an aarch64 host (GB10/Graviton/GH200)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Release channels: the hook pins by the plugin's channel. This suite guards the STABLE customer path, so it runs the
# hook from a throwaway plugin tree whose plugin.json is a stable version (the repo itself is a beta on `next`).
# The beta path is hooks/__tests__/ensure-decrypt-channel.test.sh.
STABLE_TREE="$(mktemp -d)"; trap 'rm -rf "$STABLE_TREE"' EXIT
mkdir -p "$STABLE_TREE/.claude-plugin" "$STABLE_TREE/hooks"
printf '{"name":"oss","version":"2.0.94"}\n' > "$STABLE_TREE/.claude-plugin/plugin.json"
cp "$SCRIPT_DIR/../ensure-decrypt-cli.sh" "$SCRIPT_DIR"/../oss-decrypt-checksums*.txt "$STABLE_TREE/hooks/"
HOOK_SCRIPT="$STABLE_TREE/hooks/ensure-decrypt-cli.sh"

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
    local test_name="Returns 0 without any download when the installed binary is current"
    ((TESTS_RUN++))

    setup_test_env

    # Setup: installed binary reports exactly what the real pinned asset reports (cli-decrypt-v1.2.4 -> v1.2.4)
    mkdir -p "$TEST_HOME/.oss/bin"
    cat > "$TEST_HOME/.oss/bin/oss-decrypt" << 'MOCKEOF'
#!/bin/bash
if [[ "$1" == "--version" ]]; then
    echo "oss-decrypt v1.2.4"
else
    echo "mock binary"
fi
MOCKEOF
    chmod +x "$TEST_HOME/.oss/bin/oss-decrypt"
    local net_log="$TEST_HOME/net.log" offline_mock; offline_mock=$(mktemp -d)
    printf '#!/bin/sh\necho "$*" >> "%s"\nexit 22\n' "$net_log" > "$offline_mock/curl"; chmod +x "$offline_mock/curl"

    local result exit_code=0
    result=$(PATH="$offline_mock:$PATH" "$HOOK_SCRIPT" 2>&1) || exit_code=$?
    local downloads; downloads=$(wc -l < "$net_log" 2>/dev/null | tr -d ' '); downloads=${downloads:-0}

    rm -rf "$offline_mock"; teardown_test_env

    if [[ $exit_code -eq 0 && "$downloads" == "0" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0 and no download" "exit=$exit_code downloads=$downloads"
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
    OFFLINE_LOG="$TEST_HOME/offline.log"
    local offline_mock; offline_mock=$(mktemp -d)
    printf '#!/bin/sh\necho "$*" >> "%s"\nexit 22\n' "$OFFLINE_LOG" > "$offline_mock/curl"; chmod +x "$offline_mock/curl"
    PATH="$offline_mock:$PATH" "$HOOK_SCRIPT" 2>&1 || true

    # Check if directory was created
    if [[ -d "$TEST_HOME/.oss/bin" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "directory exists" "directory missing"
    fi

    if [[ ! -s "$OFFLINE_LOG" ]]; then fail "$test_name (offline)" "download served by an offline stub" "real network used"; ((TESTS_RUN++)); fi
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

    # Normalize arch (mirror the hook: x86_64->x64, aarch64->arm64)
    [[ "$arch" == "x86_64" ]] && arch="x64"
    [[ "$arch" == "aarch64" ]] && arch="arm64"

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
    OFFLINE_LOG="$TEST_HOME/offline.log"
    local offline_mock; offline_mock=$(mktemp -d)
    printf '#!/bin/sh\necho "$*" >> "%s"\nexit 22\n' "$OFFLINE_LOG" > "$offline_mock/curl"; chmod +x "$offline_mock/curl"
    result=$(PATH="$offline_mock:$PATH" "$HOOK_SCRIPT" 2>&1) || true

    if [[ ! -s "$OFFLINE_LOG" ]]; then fail "$test_name (offline)" "download served by an offline stub" "real network used"; ((TESTS_RUN++)); fi
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
#   - sha256_mode: "OK" to serve checksum, "FAIL" to simulate 404, "BINFAIL" to fail the binary download
# =============================================================================
setup_mock_curl() {
    local staging_dir="$1"
    local sha256_mode="$2"

    MOCK_BIN_DIR=$(mktemp -d)
    # Write the mock curl script with single-quoted heredoc (no expansion)
    cat > "$MOCK_BIN_DIR/curl" << 'CURLEOF'
#!/bin/bash
# Mock curl - reads from staging files
ALL_ARGS="$*"
OUTPUT_FILE=""
URL=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        -o) OUTPUT_FILE="$2"; shift 2 ;;
        -sL|-s|-L|-fsSL) shift ;;
        --proto|--connect-timeout|--speed-limit|--speed-time|--max-time) shift 2 ;;
        *) URL="$1"; shift ;;
    esac
done
CURLEOF

    # Append the routing logic (with variable expansion for paths)
    cat >> "$MOCK_BIN_DIR/curl" << CURLEOF
# Record every requested URL when a log path is provided (for asset-name assertions)
[[ -n "\${MOCK_CURL_URL_LOG:-}" ]] && echo "\$URL" >> "\$MOCK_CURL_URL_LOG"
[[ -n "\${MOCK_CURL_ARGS_LOG:-}" ]] && echo "\$ALL_ARGS" >> "\$MOCK_CURL_ARGS_LOG"
[[ -n "\${MOCK_CURL_OUT_LOG:-}" ]] && echo "\$OUTPUT_FILE" >> "\$MOCK_CURL_OUT_LOG"
if [[ "\$URL" == *.sha256 ]]; then
    if [[ "$sha256_mode" == "FAIL" ]]; then
        exit 1
    fi
    cp "$staging_dir/checksum" "\$OUTPUT_FILE"
else
    [[ "$sha256_mode" == "BINFAIL" ]] && exit 22
    cp "$staging_dir/binary" "\$OUTPUT_FILE"
fi
exit 0
CURLEOF
    chmod +x "$MOCK_BIN_DIR/curl"

    export PATH="$MOCK_BIN_DIR:$PATH"
}

teardown_mock_curl() {
    unset OSS_DECRYPT_CHECKSUMS
    rm -rf "$MOCK_BIN_DIR"
}

# =============================================================================
# Helper: Mock `uname` so we can simulate any platform/arch (e.g. aarch64 Linux)
# without needing that hardware. Mirrors the real uname contract the hook uses:
#   uname -s -> platform, uname -m -> machine
# Usage: setup_mock_uname <platform> <machine>
# =============================================================================
setup_mock_uname() {
    local platform="$1"
    local machine="$2"

    MOCK_UNAME_DIR=$(mktemp -d)
    cat > "$MOCK_UNAME_DIR/uname" << UNAMEEOF
#!/bin/bash
case "\$1" in
    -s) echo "$platform" ;;
    -m) echo "$machine" ;;
    *)  echo "$platform" ;;
esac
UNAMEEOF
    chmod +x "$MOCK_UNAME_DIR/uname"
    export PATH="$MOCK_UNAME_DIR:$PATH"
}

teardown_mock_uname() {
    rm -rf "$MOCK_UNAME_DIR"
}

# =============================================================================
# ACCEPTANCE TEST: aarch64 Linux host installs the Linux-arm64 binary
#
# @behavior On an aarch64 Linux box (GB10, Graviton, GH200, Ampere) the decrypt
#           CLI auto-installs so the OSS pipeline (queue/build/plan) can run.
# @user-story As an aarch64 Linux user, I can run OSS commands without a manual
#             binary install.
# @acceptance-criteria Hook resolves aarch64 -> arm64, downloads the
#             oss-decrypt-Linux-arm64 asset, verifies its checksum, exits 0.
# @boundary ensure-decrypt-cli.sh (CLI/system boundary)
# =============================================================================
test_aarch64_installs_arm64_binary() {
    local test_name="aarch64 Linux host installs the Linux-arm64 binary"
    ((TESTS_RUN++))

    setup_test_env

    # GIVEN - a fake arm64 binary + matching checksum staged for download
    local staging_dir
    staging_dir=$(mktemp -d)
    cat > "$staging_dir/binary" << 'BINEOF'
#!/bin/bash
if [[ "$1" == "--version" ]]; then echo "oss-decrypt v1.2.4"
elif [[ "$1" == "--setup" ]]; then exit 0
else echo "mock"; fi
BINEOF
    local expected_hash
    expected_hash=$(shasum -a 256 "$staging_dir/binary" | awk '{print $1}')
    # Asset name the hook MUST request on aarch64 Linux:
    echo "${expected_hash}  oss-decrypt-Linux-arm64" > "$staging_dir/checksum"

    # Record requested URLs so we can assert the arm64 asset was fetched
    local url_log
    url_log=$(mktemp)
    export MOCK_CURL_URL_LOG="$url_log"

    export OSS_DECRYPT_CHECKSUMS="$staging_dir/checksum"   # committed manifest = same known-good hash
    setup_mock_curl "$staging_dir" "OK"

    # GIVEN - the host reports itself as aarch64 Linux
    setup_mock_uname "Linux" "aarch64"

    # No existing binary -> forces a fresh download through the arch path
    mkdir -p "$TEST_HOME/.oss/bin"

    # WHEN - the ensure hook runs
    local result exit_code=0
    result=$("$HOOK_SCRIPT" 2>&1) || exit_code=$?

    # THEN - it downloaded the -arm64 asset, verified it, and exited 0
    local requested_arm64=false
    grep -q "oss-decrypt-Linux-arm64" "$url_log" && requested_arm64=true

    teardown_mock_uname
    teardown_mock_curl
    unset MOCK_CURL_URL_LOG
    rm -f "$url_log"
    rm -rf "$staging_dir"
    teardown_test_env

    if [[ $exit_code -eq 0 ]] && [[ "$requested_arm64" == "true" ]] \
        && echo "$result" | grep -qi "checksum: verified"; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0 + fetched -arm64 asset + checksum verified" \
            "exit=$exit_code requested_arm64=$requested_arm64 output: $result"
    fi
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
if [[ "$1" == "--version" ]]; then echo "oss-decrypt v1.2.4"
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

    export OSS_DECRYPT_CHECKSUMS="$staging_dir/checksum"   # committed manifest = same known-good hash
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
# =============================================================================
# TEST: hook must NOT claim "ready" when --setup fails (no false positive)
#
# @behavior The auto-install hook reports honest status: if the binary installs
#           but `--setup` does not produce credentials, it does NOT print a bare
#           "ready" success — it tells the user setup is incomplete.
# @acceptance-criteria install still exits 0 (non-fatal), but output contains NO
#           "ready" success line; instead names setup incomplete.
# @boundary ensure-decrypt-cli.sh (system boundary)
# @regression v1.2.2: hook printed "…ready." even when --setup failed.
# =============================================================================
test_setup_failure_no_false_ready() {
    local test_name="Hook does not print false 'ready' when --setup fails"
    ((TESTS_RUN++))

    setup_test_env

    # Staged binary: --version succeeds (passes runnability), --setup FAILS,
    # and it never writes credentials.enc.
    local staging_dir
    staging_dir=$(mktemp -d)
    cat > "$staging_dir/binary" << 'BINEOF'
#!/bin/bash
if [[ "$1" == "--version" ]]; then echo "oss-decrypt v1.2.4"; exit 0
elif [[ "$1" == "--setup" ]]; then echo "setup failed" >&2; exit 1
else echo "mock"; fi
BINEOF
    local expected_hash
    expected_hash=$(shasum -a 256 "$staging_dir/binary" | awk '{print $1}')
    local PLATFORM=$(uname -s)
    local ARCH=$(uname -m)
    [[ "$ARCH" == "x86_64" ]] && ARCH="x64"
    [[ "$ARCH" == "aarch64" ]] && ARCH="arm64"
    echo "${expected_hash}  oss-decrypt-${PLATFORM}-${ARCH}" > "$staging_dir/checksum"

    export OSS_DECRYPT_CHECKSUMS="$staging_dir/checksum"   # committed manifest = same known-good hash
    setup_mock_curl "$staging_dir" "OK"
    mkdir -p "$TEST_HOME/.oss/bin"   # fresh download path

    local result exit_code=0
    result=$("$HOOK_SCRIPT" 2>&1) || exit_code=$?

    teardown_mock_curl
    rm -rf "$staging_dir"
    teardown_test_env

    # Install is non-fatal (exit 0) but must NOT falsely claim readiness.
    if [[ $exit_code -eq 0 ]] \
        && ! echo "$result" | grep -qiE "v[0-9.]+ ready|CLI .*ready" \
        && echo "$result" | grep -qi "setup did not complete\|finish.*setup"; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0 + NO 'ready' + names setup-incomplete" \
            "exit=$exit_code output: $result"
    fi
}


# =============================================================================
# TEST: downloads come from a PINNED cli-decrypt release, never "latest"
#
# @behavior A fresh install fetches oss-decrypt + .sha256 from
#           releases/download/<OSS_DECRYPT_TAG>/ (default cli-decrypt-v1.2.4).
# @regression 2026-06-28 → 2026-10-09: oss-launch-v2.0.78 became GitHub "Latest" without
#           oss-decrypt assets; latest/download 404'd for every new machine.
# =============================================================================
record_urls_install() {   # usage: record_urls_install <urls_log> [env assignments...]
    local urls="$1"; shift
    local mock; mock=$(mktemp -d)
    cat > "$mock/curl" << CURLEOF
#!/bin/sh
for a in "\$@"; do case "\$a" in https://*) echo "\$a" >> "$urls";; esac; done
exit 22
CURLEOF
    chmod +x "$mock/curl"
    env "$@" PATH="$mock:$PATH" bash "$HOOK_SCRIPT" >/dev/null 2>&1 || true
    rm -rf "$mock"
}

test_default_download_is_pinned_tag() {
    local test_name="Fresh install downloads from releases/download/cli-decrypt-v1.2.4/, not latest"
    ((TESTS_RUN++))
    setup_test_env
    local urls="$TEST_HOME/urls.log"
    record_urls_install "$urls" HOME="$TEST_HOME"
    if grep -q "/releases/download/cli-decrypt-v1.2.4/oss-decrypt-" "$urls" 2>/dev/null && ! grep -q "/latest/" "$urls"; then
        echo -e "${GREEN}✓${NC} $test_name"; ((TESTS_PASSED++))
    else
        echo -e "${RED}✗${NC} $test_name (requested: $(head -1 "$urls" 2>/dev/null))"; ((TESTS_FAILED++))
    fi
    teardown_test_env
}

test_tag_override() {
    local test_name="OSS_DECRYPT_TAG overrides the pinned release tag"
    ((TESTS_RUN++))
    setup_test_env
    local urls="$TEST_HOME/urls.log"
    record_urls_install "$urls" HOME="$TEST_HOME" OSS_DECRYPT_TAG="cli-decrypt-v9.9.9"
    if grep -q "/releases/download/cli-decrypt-v9.9.9/oss-decrypt-" "$urls" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} $test_name"; ((TESTS_PASSED++))
    else
        echo -e "${RED}✗${NC} $test_name (requested: $(head -1 "$urls" 2>/dev/null))"; ((TESTS_FAILED++))
    fi
    teardown_test_env
}


# =============================================================================
# TWO-METHOD VERIFY (same standard as ensure-oss-launch.sh, oss-launch-release-hardening):
# in-release .sha256 AND a committed, code-reviewed manifest (hooks/oss-decrypt-checksums.txt).
# A release-write compromise can swap the binary AND its in-release .sha256; it cannot change
# the committed hash. Fail closed: no manifest, no entry, or mismatch => reject.
# =============================================================================
stage_valid_binary() {   # usage: stage_valid_binary <staging_dir>; echoes the artifact name
    local d="$1"
    cat > "$d/binary" << 'BINEOF'
#!/bin/bash
if [[ "$1" == "--version" ]]; then echo "oss-decrypt v1.2.4"   # = what the real cli-decrypt-v1.2.4 asset reports
elif [[ "$1" == "--setup" ]]; then mkdir -p "$HOME/.oss"; touch "$HOME/.oss/credentials.enc"; exit 0
else echo "mock"; fi
BINEOF
    local p a; p=$(uname -s); a=$(uname -m); [[ "$a" == "x86_64" ]] && a="x64"; [[ "$a" == "aarch64" ]] && a="arm64"
    echo "$(shasum -a 256 "$d/binary" | awk '{print $1}')  oss-decrypt-$p-$a" > "$d/checksum"
    echo "oss-decrypt-$p-$a"
}

run_fresh_install() {   # usage: run_fresh_install <staging_dir> [env...]; sets RUN_OUT / RUN_RC
    local staging_dir="$1"; shift
    setup_mock_curl "$staging_dir" "OK"
    RUN_RC=0; RUN_OUT=$(env "$@" "$HOOK_SCRIPT" 2>&1) || RUN_RC=$?
    teardown_mock_curl
}

test_committed_hash_match_installs() {
    local test_name="Committed manifest hash matches -> installs"
    ((TESTS_RUN++)); setup_test_env
    local st; st=$(mktemp -d); local art; art=$(stage_valid_binary "$st")
    echo "$(awk '{print $1}' "$st/checksum")  $art" > "$st/manifest"
    run_fresh_install "$st" HOME="$TEST_HOME" OSS_DECRYPT_CHECKSUMS="$st/manifest"
    if [[ $RUN_RC -eq 0 && -x "$TEST_HOME/.oss/bin/oss-decrypt" ]] && echo "$RUN_OUT" | grep -qi "committed.*verified"; then pass "$test_name"
    else fail "$test_name" "exit 0 + committed hash verified" "rc=$RUN_RC out=$RUN_OUT"; fi
    rm -rf "$st"; teardown_test_env
}

test_committed_hash_mismatch_rejects() {
    local test_name="Committed hash MISMATCH rejects even when in-release .sha256 matches (release tamper)"
    ((TESTS_RUN++)); setup_test_env
    local st; st=$(mktemp -d); local art; art=$(stage_valid_binary "$st")
    echo "$(printf 'a%.0s' {1..64})  $art" > "$st/manifest"
    run_fresh_install "$st" HOME="$TEST_HOME" OSS_DECRYPT_CHECKSUMS="$st/manifest"
    if [[ $RUN_RC -ne 0 && ! -e "$TEST_HOME/.oss/bin/oss-decrypt" ]] && grep -qx '\[verify\] Committed hash: FAILED — mismatch' <<<"$RUN_OUT"; then pass "$test_name"
    else fail "$test_name" "non-zero exit, no binary left, plain mismatch message" "rc=$RUN_RC out=$(grep Committed <<<"$RUN_OUT") exists=$([[ -e "$TEST_HOME/.oss/bin/oss-decrypt" ]] && echo yes || echo no)"; fi
    rm -rf "$st"; teardown_test_env
}

test_committed_manifest_missing_entry_rejects() {
    local test_name="Committed manifest without an entry for this platform rejects (fail closed)"
    ((TESTS_RUN++)); setup_test_env
    local st; st=$(mktemp -d); stage_valid_binary "$st" >/dev/null
    echo "$(awk '{print $1}' "$st/checksum")  oss-decrypt-Plan9-mips" > "$st/manifest"
    run_fresh_install "$st" HOME="$TEST_HOME" OSS_DECRYPT_CHECKSUMS="$st/manifest"
    if [[ $RUN_RC -ne 0 && ! -e "$TEST_HOME/.oss/bin/oss-decrypt" ]] && grep -q 'Committed hash: FAILED — no committed entry for oss-decrypt-' <<<"$RUN_OUT"; then pass "$test_name"
    else fail "$test_name" "non-zero exit, no binary left, names the missing entry" "rc=$RUN_RC out=$(grep Committed <<<"$RUN_OUT")"; fi
    rm -rf "$st"; teardown_test_env
}

test_manifest_found_via_plugin_root() {
    local test_name="Hook copy in ~/.oss/hooks finds the manifest via ~/.oss/plugin-root"
    ((TESTS_RUN++)); setup_test_env
    local st; st=$(mktemp -d); local art; art=$(stage_valid_binary "$st")
    local plugin="$TEST_HOME/plugin"; mkdir -p "$plugin/hooks" "$TEST_HOME/.oss/hooks"
    echo "$(awk '{print $1}' "$st/checksum")  $art" > "$plugin/hooks/oss-decrypt-checksums.txt"
    echo "$plugin" > "$TEST_HOME/.oss/plugin-root"
    cp "$HOOK_SCRIPT" "$TEST_HOME/.oss/hooks/ensure-decrypt-cli.sh"
    setup_mock_curl "$st" "OK"
    RUN_RC=0; RUN_OUT=$(env -u OSS_DECRYPT_CHECKSUMS HOME="$TEST_HOME" bash "$TEST_HOME/.oss/hooks/ensure-decrypt-cli.sh" 2>&1) || RUN_RC=$?
    teardown_mock_curl
    if [[ $RUN_RC -eq 0 && -x "$TEST_HOME/.oss/bin/oss-decrypt" ]]; then pass "$test_name"
    else fail "$test_name" "installs using plugin-root manifest" "rc=$RUN_RC out=$RUN_OUT"; fi
    rm -rf "$st"; teardown_test_env
}


# =============================================================================
# ATOMIC INSTALL (security gate M1): unverified bytes must never sit at the executable final path,
# and a failed update must leave the customer's working binary untouched.
# =============================================================================
test_download_never_written_to_final_path() {
    local test_name="Download goes to a temp file, never straight to ~/.oss/bin/oss-decrypt"
    ((TESTS_RUN++)); setup_test_env
    local st; st=$(mktemp -d); local art; art=$(stage_valid_binary "$st")
    echo "$(awk '{print $1}' "$st/checksum")  $art" > "$st/manifest"
    local outs="$TEST_HOME/outs.log"
    run_fresh_install "$st" HOME="$TEST_HOME" OSS_DECRYPT_CHECKSUMS="$st/manifest" MOCK_CURL_OUT_LOG="$outs"
    if [[ $RUN_RC -eq 0 && -s "$outs" ]] && ! grep -qx "$TEST_HOME/.oss/bin/oss-decrypt" "$outs" && [[ -x "$TEST_HOME/.oss/bin/oss-decrypt" ]]; then pass "$test_name"
    else fail "$test_name" "installed, curl -o never the final path" "rc=$RUN_RC outs=$(tr '\n' ' ' < "$outs" 2>/dev/null)"; fi
    rm -rf "$st"; teardown_test_env
}

test_failed_update_keeps_working_binary() {
    local test_name="Failed update leaves the existing working binary byte-identical and executable"
    ((TESTS_RUN++)); setup_test_env
    mkdir -p "$TEST_HOME/.oss/bin"
    printf '#!/bin/bash\n[[ "$1" == "--version" ]] && echo "oss-decrypt v1.0.0"\n' > "$TEST_HOME/.oss/bin/oss-decrypt"
    chmod 755 "$TEST_HOME/.oss/bin/oss-decrypt"
    local before; before=$(shasum -a 256 "$TEST_HOME/.oss/bin/oss-decrypt" | awk '{print $1}')
    local st; st=$(mktemp -d); local art; art=$(stage_valid_binary "$st")
    echo "$(printf 'c%.0s' {1..64})  $art" > "$st/manifest"     # committed hash will NOT match -> update rejected
    run_fresh_install "$st" HOME="$TEST_HOME" OSS_DECRYPT_CHECKSUMS="$st/manifest"
    local after; after=$(shasum -a 256 "$TEST_HOME/.oss/bin/oss-decrypt" 2>/dev/null | awk '{print $1}')
    local leftovers; leftovers=$(find "$TEST_HOME/.oss/bin" -type f ! -name oss-decrypt | wc -l | tr -d ' ')
    if [[ $RUN_RC -ne 0 && "$after" == "$before" && -x "$TEST_HOME/.oss/bin/oss-decrypt" && "$leftovers" == "0" ]]; then pass "$test_name"
    else fail "$test_name" "rc!=0, old binary intact, no temp files left" "rc=$RUN_RC same=$([[ "$after" == "$before" ]] && echo yes || echo no) leftovers=$leftovers"; fi
    rm -rf "$st"; teardown_test_env
}


# =============================================================================
# DOWNLOAD HARDENING (ship gates): fail on HTTP errors, HTTPS only, abort stalled transfers;
# the tag test seam only accepts a cli-decrypt release tag; failures give an actionable next step.
# =============================================================================
test_curl_flags_hardened() {
    local test_name="Both downloads use -f, HTTPS-only and stall-abort flags"
    ((TESTS_RUN++)); setup_test_env
    local st; st=$(mktemp -d); local art; art=$(stage_valid_binary "$st")
    echo "$(awk '{print $1}' "$st/checksum")  $art" > "$st/manifest"
    local args="$TEST_HOME/args.log"
    run_fresh_install "$st" HOME="$TEST_HOME" OSS_DECRYPT_CHECKSUMS="$st/manifest" MOCK_CURL_ARGS_LOG="$args"
    local n; n=$(grep -c -- "-fsSL --proto =https --connect-timeout 15 --speed-limit 1024 --speed-time 60" "$args" 2>/dev/null)
    if [[ $RUN_RC -eq 0 && "$n" == "2" ]]; then pass "$test_name"
    else fail "$test_name" "2 hardened curl calls" "rc=$RUN_RC calls=$(cat "$args" 2>/dev/null | tr '\n' ';')"; fi
    rm -rf "$st"; teardown_test_env
}

test_invalid_tag_rejected_without_network() {
    local test_name="OSS_DECRYPT_TAG that is not cli-decrypt-vX.Y.Z is rejected before any download"
    ((TESTS_RUN++)); setup_test_env
    local urls="$TEST_HOME/urls.log"
    record_urls_install "$urls" HOME="$TEST_HOME" OSS_DECRYPT_TAG="../../../../evil/repo/releases/download/x"
    local rc=0; HOME="$TEST_HOME" OSS_DECRYPT_TAG="../../evil" PATH="/usr/bin:/bin" bash "$HOOK_SCRIPT" >/dev/null 2>&1 || rc=$?
    if [[ ! -s "$urls" && $rc -ne 0 ]]; then pass "$test_name"
    else fail "$test_name" "no URL requested, non-zero exit" "rc=$rc urls=$(head -1 "$urls" 2>/dev/null)"; fi
    teardown_test_env
}

test_failures_do_not_loop_to_login() {
    local test_name="Install failures give an actionable step, never 'run /oss:login for manual installation'"
    ((TESTS_RUN++)); setup_test_env
    local st; st=$(mktemp -d); local art; art=$(stage_valid_binary "$st")
    echo "$(printf 'd%.0s' {1..64})  $art" > "$st/manifest"
    run_fresh_install "$st" HOME="$TEST_HOME" OSS_DECRYPT_CHECKSUMS="$st/manifest"
    local hook_refs; hook_refs=$(grep -c "manual installation" "$HOOK_SCRIPT")
    if [[ $RUN_RC -ne 0 && "$hook_refs" == "0" ]] && grep -q "Check that github.com is reachable and the plugin is up to date" <<<"$RUN_OUT"; then pass "$test_name"
    else fail "$test_name" "no 'manual installation' anywhere in the hook; output names github.com" "rc=$RUN_RC refs=$hook_refs"; fi
    rm -rf "$st"; teardown_test_env
}


test_manifest_found_beside_hook() {
    local test_name="Hook copy finds the manifest beside itself (no plugin-root, no env override)"
    ((TESTS_RUN++)); setup_test_env
    local st; st=$(mktemp -d); local art; art=$(stage_valid_binary "$st")
    mkdir -p "$TEST_HOME/.oss/hooks" "$TEST_HOME/decoy/hooks"
    cp "$HOOK_SCRIPT" "$TEST_HOME/.oss/hooks/ensure-decrypt-cli.sh"
    echo "$(awk '{print $1}' "$st/checksum")  $art" > "$TEST_HOME/.oss/hooks/oss-decrypt-checksums.txt"
    echo "$(printf 'e%.0s' {1..64})  $art" > "$TEST_HOME/decoy/hooks/oss-decrypt-checksums.txt"   # wrong hash
    echo "$TEST_HOME/decoy" > "$TEST_HOME/.oss/plugin-root"
    setup_mock_curl "$st" "OK"
    RUN_RC=0; RUN_OUT=$(env -u OSS_DECRYPT_CHECKSUMS HOME="$TEST_HOME" bash "$TEST_HOME/.oss/hooks/ensure-decrypt-cli.sh" 2>&1) || RUN_RC=$?
    teardown_mock_curl
    if [[ $RUN_RC -eq 0 && -x "$TEST_HOME/.oss/bin/oss-decrypt" ]]; then pass "$test_name"
    else fail "$test_name" "installs using the manifest beside the hook" "rc=$RUN_RC out=$(grep Committed <<<"$RUN_OUT")"; fi
    rm -rf "$st"; teardown_test_env
}

test_committed_manifest_is_complete_and_matches_tag() {
    local test_name="Committed manifest: one 64-hex entry per platform; header tag == hook's pinned tag"
    ((TESTS_RUN++))
    local mf; mf="$(dirname "$HOOK_SCRIPT")/oss-decrypt-checksums.txt"
    local tag; tag=$(grep -oE 'OSS_DECRYPT_STABLE_TAG="cli-decrypt-v[0-9]+\.[0-9]+\.[0-9]+"' "$HOOK_SCRIPT" | sed -E 's/.*="([^"]+)"/\1/')
    local ok=1 a
    for a in Darwin-arm64 Darwin-x64 Linux-arm64 Linux-x64; do
        [[ "$(grep -cE "^[0-9a-f]{64}  oss-decrypt-$a$" "$mf")" == "1" ]] || ok=0
    done
    [[ -n "$tag" ]] && grep -q "($tag)" "$mf" || ok=0
    [[ "$(grep -cvE '^#|^$' "$mf")" == "4" ]] || ok=0
    if [[ $ok == 1 ]]; then pass "$test_name"; else fail "$test_name" "4 valid entries + tag $tag in header" "$(cat "$mf")"; fi
}


test_stale_temp_files_swept_fresh_kept() {
    local test_name="Install sweeps temp files >60 min old (left by SIGKILL) but keeps a concurrent install's fresh one"
    ((TESTS_RUN++)); setup_test_env
    mkdir -p "$TEST_HOME/.oss/bin"
    echo old > "$TEST_HOME/.oss/bin/.oss-decrypt.STALE1"; touch -t 202001010000 "$TEST_HOME/.oss/bin/.oss-decrypt.STALE1"
    echo new > "$TEST_HOME/.oss/bin/.oss-decrypt.FRESH1"
    local urls="$TEST_HOME/urls.log"
    record_urls_install "$urls" HOME="$TEST_HOME"
    if [[ ! -e "$TEST_HOME/.oss/bin/.oss-decrypt.STALE1" && -e "$TEST_HOME/.oss/bin/.oss-decrypt.FRESH1" ]]; then pass "$test_name"
    else fail "$test_name" "stale removed, fresh kept" "stale=$([[ -e "$TEST_HOME/.oss/bin/.oss-decrypt.STALE1" ]] && echo kept || echo gone) fresh=$([[ -e "$TEST_HOME/.oss/bin/.oss-decrypt.FRESH1" ]] && echo kept || echo gone)"; fi
    teardown_test_env
}

test_interrupted_checksum_download_leaves_no_temp_file() {
    local test_name="TERM during the checksum download leaves no temp file behind"
    ((TESTS_RUN++)); setup_test_env
    local mock; mock=$(mktemp -d); local outs="$TEST_HOME/outs.log"
    cat > "$mock/curl" << CURLEOF
#!/bin/bash
out=""; url=""; prev=""; for a in "\$@"; do [[ "\$prev" == "-o" ]] && out="\$a"; [[ "\$a" == https://* ]] && url="\$a"; prev="\$a"; done
echo "\$out" >> "$outs"; [[ "\$url" == *.sha256 ]] && echo "\$url" >> "$outs.urls"; echo partial > "\$out"; [[ "\$url" == *.sha256 ]] && sleep 2; exit 0
CURLEOF
    chmod +x "$mock/curl"
    HOME="$TEST_HOME" PATH="$mock:$PATH" bash "$HOOK_SCRIPT" >/dev/null 2>&1 &
    local pid=$! n=0; until grep -q sha256 "$outs.urls" 2>/dev/null || [[ $((n++)) -ge 100 ]]; do sleep 0.05; done   # wait until the checksum download is in flight
    sleep 0.2; kill -TERM "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; sleep 1
    local left=0 f; while read -r f; do [[ -e "$f" ]] && ((left++)); done < "$outs"
    if [[ -s "$outs" && "$left" == "0" ]]; then pass "$test_name"; else fail "$test_name" "every curl -o target removed" "$left left: $(cat "$outs" 2>/dev/null | tr '\n' ' ')"; fi
    while read -r f; do rm -f "$f"; done < "$outs" 2>/dev/null
    rm -rf "$mock"; teardown_test_env
}


test_failed_second_mktemp_leaves_nothing() {
    local test_name="If creating the checksum temp file fails, no binary temp file is left behind"
    ((TESTS_RUN++)); setup_test_env
    local mock; mock=$(mktemp -d); local real_mktemp; real_mktemp=$(command -v mktemp)
    cat > "$mock/mktemp" << MKEOF
#!/bin/bash
[[ \$# -eq 0 ]] && exit 1          # the checksum temp file (no template) fails
exec "$real_mktemp" "\$@"
MKEOF
    printf '#!/bin/sh\nexit 22\n' > "$mock/curl"; chmod +x "$mock/mktemp" "$mock/curl"
    HOME="$TEST_HOME" PATH="$mock:$PATH" bash "$HOOK_SCRIPT" >/dev/null 2>&1
    local left; left=$(find "$TEST_HOME/.oss/bin" -name '.oss-decrypt.*' 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$left" == "0" ]]; then pass "$test_name"; else fail "$test_name" "0 temp files" "$left left"; fi
    rm -rf "$mock"; teardown_test_env
}

# @behavior A new install downloads the oss-decrypt build that matches this repo's CLI source:
#           the hook's pinned tag is cli-decrypt-v<packages/cli-decrypt/package.json version>.
# @regression v1.2.3 shipped a binary that reported 1.2.1; the pin must follow the released version.
test_pinned_tag_matches_cli_package_version() {
    local test_name="the BETA pin matches the CLI package version (the CLI built from this tree, published as a pre-release)"
    ((TESTS_RUN++))
    local pkg; pkg="$SCRIPT_DIR/../../packages/cli-decrypt/package.json"
    local ver; ver=$(node -p "require(process.argv[1]).version" "$pkg" 2>/dev/null)
    local tag; tag=$(grep -oE 'OSS_DECRYPT_BETA_TAG="cli-decrypt-v[^"]+"' "$HOOK_SCRIPT" | sed -E 's/.*="([^"]+)"/\1/')
    if [[ -n "$ver" && "$tag" == "cli-decrypt-v$ver" ]]; then pass "$test_name"
    else fail "$test_name" "cli-decrypt-v$ver" "${tag:-<none>}"; fi
}

# @behavior The reviewed checksum manifest names exactly one release: the one the hook pins.
test_committed_checksums_header_names_pinned_tag() {
    local test_name="committed checksums header names the pinned tag"
    ((TESTS_RUN++))
    local mf; mf="$(dirname "$HOOK_SCRIPT")/oss-decrypt-checksums.txt"
    local tag; tag=$(grep -oE 'OSS_DECRYPT_STABLE_TAG="cli-decrypt-v[0-9]+\.[0-9]+\.[0-9]+"' "$HOOK_SCRIPT" | sed -E 's/.*="([^"]+)"/\1/')
    local named; named=$(grep -oE 'cli-decrypt-v[0-9]+\.[0-9]+\.[0-9]+' "$mf" | sort -u)
    if [[ -n "$tag" && "$named" == "$tag" ]]; then pass "$test_name"
    else fail "$test_name" "manifest names only $tag" "$(echo $named)"; fi
}

# =============================================================================
# D5 (PR2-R1): MINIMUM_VERSION == the pinned release (1.2.4). Every earlier install
# (v1.2.1-v1.2.3, all of which report "1.2.1") is replaced by the verified pinned asset,
# so the v1.2.4 security fixes reach existing users. The pinned asset reports 1.2.4,
# so once installed it is kept with no further download (no re-download loop).
# =============================================================================
# usage: run_with_installed <reported version>; sets RUN_RC, RUN_DOWNLOADS, RUN_REPLACED
run_with_installed() {
    mkdir -p "$TEST_HOME/.oss/bin"
    printf '#!/bin/bash\n[[ "$1" == "--version" ]] && echo "oss-decrypt v%s" || echo mock\n' "$1" > "$TEST_HOME/.oss/bin/oss-decrypt"
    chmod +x "$TEST_HOME/.oss/bin/oss-decrypt"
    local st; st=$(mktemp -d); local art; art=$(stage_valid_binary "$st")
    echo "$(awk '{print $1}' "$st/checksum")  $art" > "$st/manifest"
    local urls="$TEST_HOME/urls.log"; rm -f "$urls"
    run_fresh_install "$st" HOME="$TEST_HOME" OSS_DECRYPT_CHECKSUMS="$st/manifest" MOCK_CURL_URL_LOG="$urls"
    RUN_DOWNLOADS=$(wc -l 2>/dev/null < "$urls" | tr -d ' '); RUN_DOWNLOADS=${RUN_DOWNLOADS:-0}
    RUN_REPLACED=no; cmp -s "$st/binary" "$TEST_HOME/.oss/bin/oss-decrypt" && RUN_REPLACED=yes
    RUN_STAGING="$st"
}

# @behavior D5: an install reporting 1.2.1 (v1.2.1/v1.2.2/v1.2.3) is upgraded to the pinned asset.
test_v121_install_is_upgraded_to_pinned() {
    local test_name="An installed binary reporting 1.2.1 is replaced by the pinned release"
    ((TESTS_RUN++)); setup_test_env
    run_with_installed "1.2.1"; rm -rf "$RUN_STAGING"
    if [[ $RUN_RC -eq 0 && "$RUN_DOWNLOADS" != "0" && "$RUN_REPLACED" == "yes" ]]; then pass "$test_name"
    else fail "$test_name" "exit 0, download attempted, pinned asset installed" "rc=$RUN_RC downloads=$RUN_DOWNLOADS replaced=$RUN_REPLACED"; fi
    teardown_test_env
}

# @behavior D5: any version below the pinned release (here 1.2.3) is upgraded too.
test_v123_install_is_upgraded_to_pinned() {
    local test_name="An installed binary reporting 1.2.3 is replaced by the pinned release"
    ((TESTS_RUN++)); setup_test_env
    run_with_installed "1.2.3"; rm -rf "$RUN_STAGING"
    if [[ $RUN_RC -eq 0 && "$RUN_DOWNLOADS" != "0" && "$RUN_REPLACED" == "yes" ]]; then pass "$test_name"
    else fail "$test_name" "exit 0, download attempted, pinned asset installed" "rc=$RUN_RC downloads=$RUN_DOWNLOADS replaced=$RUN_REPLACED"; fi
    teardown_test_env
}

# @behavior D5: an install already at the pinned version (1.2.4) is kept with no download.
test_v124_install_kept_without_download() {
    local test_name="An installed binary reporting 1.2.4 is kept with no download"
    ((TESTS_RUN++)); setup_test_env
    run_with_installed "1.2.4"; rm -rf "$RUN_STAGING"
    if [[ $RUN_RC -eq 0 && "$RUN_DOWNLOADS" == "0" && "$RUN_REPLACED" == "no" ]]; then pass "$test_name"
    else fail "$test_name" "exit 0, no download, existing binary kept" "rc=$RUN_RC downloads=$RUN_DOWNLOADS replaced=$RUN_REPLACED"; fi
    teardown_test_env
}

# @behavior D5 no-loop: once the pinned asset is installed, the next run downloads nothing.
test_pinned_asset_not_redownloaded_on_next_run() {
    local test_name="After upgrading to the pinned asset, the next run does not download again"
    ((TESTS_RUN++)); setup_test_env
    run_with_installed "1.2.1"
    local first_rc=$RUN_RC first_replaced=$RUN_REPLACED
    local st="$RUN_STAGING" urls="$TEST_HOME/urls2.log"
    run_fresh_install "$st" HOME="$TEST_HOME" OSS_DECRYPT_CHECKSUMS="$st/manifest" MOCK_CURL_URL_LOG="$urls"
    local second; second=$(wc -l 2>/dev/null < "$urls" | tr -d ' '); second=${second:-0}
    rm -rf "$st"
    if [[ $first_rc -eq 0 && "$first_replaced" == "yes" && $RUN_RC -eq 0 && "$second" == "0" ]]; then pass "$test_name"
    else fail "$test_name" "first run installs pinned asset, second run: exit 0 and no download" "first_rc=$first_rc replaced=$first_replaced second_rc=$RUN_RC second_downloads=$second"; fi
    teardown_test_env
}

# =============================================================================
# D6 (PR2-R2) soft upgrade: with the 1.2.4 floor every older install goes down the install path.
# A DOWNLOAD failure (offline, GitHub blocked, 404, stall) must not take away a working older binary:
# warn on stderr, keep it, exit 0, retry next command. A hash MISMATCH is tampering and stays hard.
# No binary (or one that does not answer --version) + any failure stays hard. A verified asset that
# reports a version below the floor is never installed (it would be re-downloaded forever).
# =============================================================================
# usage: run_upgrade <installed: X.Y.Z|none|broken|raw:<script body>> <curl: OK|FAIL|BINFAIL> <tamper: none|release|malformed|html|empty|committed> [asset version]
# sets RUN_RC, RUN_OUT (stdout), RUN_ERR (stderr), RUN_KEPT (installed file byte-identical), RUN_ASSET (pinned asset at final path)
run_upgrade() {
    local installed="$1" curl_mode="$2" tamper="$3" asset_ver="${4:-1.2.4}" final="$TEST_HOME/.oss/bin/oss-decrypt"
    mkdir -p "$TEST_HOME/.oss/bin"
    case "$installed" in
        none) ;;
        broken) printf '#!/bin/bash\nexit 1\n' > "$final"; chmod +x "$final" ;;
        raw:*) printf '#!/bin/bash\n%s\n' "${installed#raw:}" > "$final"; chmod +x "$final" ;;
        *) printf '#!/bin/bash\n[[ "$1" == "--version" ]] && echo "oss-decrypt v%s" || echo mock\n' "$installed" > "$final"; chmod +x "$final" ;;
    esac
    local before; before=$(shasum -a 256 "$final" 2>/dev/null | awk '{print $1}')
    local st; st=$(mktemp -d); local art; art=$(stage_valid_binary "$st")
    sed "s/v1\.2\.4/v$asset_ver/" "$st/binary" > "$st/b" && mv "$st/b" "$st/binary"
    local hash; hash=$(shasum -a 256 "$st/binary" | awk '{print $1}')
    echo "$hash  $art" > "$st/checksum"; echo "$hash  $art" > "$st/manifest"
    case "$tamper" in
        release) echo "$(printf '0%.0s' {1..64})  $art" > "$st/checksum" ;;
        malformed) echo "not-a-hash  $art" > "$st/checksum" ;;
        html) printf '<!DOCTYPE html>\n<html><body>Sign in to continue to the network</body></html>\n' > "$st/checksum" ;;
        empty) : > "$st/checksum" ;;
        committed) echo "$(printf 'e%.0s' {1..64})  $art" > "$st/manifest" ;;
    esac
    setup_mock_curl "$st" "$curl_mode"
    RUN_RC=0; HOME="$TEST_HOME" OSS_DECRYPT_CHECKSUMS="$st/manifest" "$HOOK_SCRIPT" >"$TEST_HOME/out" 2>"$TEST_HOME/err" || RUN_RC=$?
    teardown_mock_curl
    RUN_ERR=$(cat "$TEST_HOME/err"); RUN_OUT=$(cat "$TEST_HOME/out")
    local after; after=$(shasum -a 256 "$final" 2>/dev/null | awk '{print $1}')
    RUN_KEPT=no; [[ -n "$before" && "$after" == "$before" && -x "$final" ]] && RUN_KEPT=yes
    RUN_ASSET=no; cmp -s "$st/binary" "$final" && RUN_ASSET=yes
    rm -rf "$st"
}
SOFT_WARN="oss-decrypt update to cli-decrypt-v1.2.4 failed"

# @behavior D6(a): offline/blocked user with a working v1.2.1 keeps every /oss command when the asset download fails.
test_asset_download_failure_keeps_runnable_binary() {
    local test_name="Installed 1.2.1 + asset download fails -> warning on stderr, exit 0, binary untouched"
    ((TESTS_RUN++)); setup_test_env
    run_upgrade "1.2.1" "BINFAIL" "none"
    if [[ $RUN_RC -eq 0 && "$RUN_KEPT" == "yes" ]] && grep -q "$SOFT_WARN (download); keeping the installed version; will retry next command" <<<"$RUN_ERR"; then pass "$test_name"
    else fail "$test_name" "rc=0, kept, stderr warning" "rc=$RUN_RC kept=$RUN_KEPT err=$RUN_ERR"; fi
    teardown_test_env
}

# @behavior D6(a): the same when only the in-release .sha256 download fails.
test_checksum_download_failure_keeps_runnable_binary() {
    local test_name="Installed 1.2.1 + .sha256 download fails -> warning on stderr, exit 0, binary untouched"
    ((TESTS_RUN++)); setup_test_env
    run_upgrade "1.2.1" "FAIL" "none"
    if [[ $RUN_RC -eq 0 && "$RUN_KEPT" == "yes" ]] && grep -q "$SOFT_WARN (download); keeping the installed version" <<<"$RUN_ERR"; then pass "$test_name"
    else fail "$test_name" "rc=0, kept, stderr warning" "rc=$RUN_RC kept=$RUN_KEPT err=$RUN_ERR"; fi
    teardown_test_env
}

# @behavior D6(b): tampering is never soft, even with a working older binary installed. Only a WELL-FORMED
#           64-hex value that disagrees (in-release .sha256 or committed manifest) is tampering.
#           (PR2-R3 item 3: round 2 listed `malformed` here; an unparseable .sha256 is not a hash that
#           disagrees, it is a download that did not deliver one, so it moved to the soft test below.)
test_hash_mismatch_with_old_binary_stays_hard() {
    local t
    for t in release committed; do
        local test_name="Installed 1.2.1 + $t hash mismatch -> exit 1, old binary kept, no soft warning"
        ((TESTS_RUN++)); setup_test_env
        run_upgrade "1.2.1" "OK" "$t"
        if [[ $RUN_RC -eq 1 && "$RUN_KEPT" == "yes" ]] && ! grep -q "$SOFT_WARN" <<<"$RUN_ERR"; then pass "$test_name"
        else fail "$test_name" "rc=1, kept, no soft warning" "rc=$RUN_RC kept=$RUN_KEPT err=$RUN_ERR"; fi
        teardown_test_env
    done
}

# @behavior D6(a) PR2-R3 item 3: a captive portal / block page answers 200 with HTML (or nothing), so both
#           curls "succeed" but no hash arrives. That is a failed download, not tampering: a user with a
#           working v1.2.1 keeps every /oss command (warn, exit 0, old binary kept, asset not installed).
test_unparseable_checksum_with_runnable_binary_is_soft() {
    local t
    for t in html empty malformed; do
        local test_name="Installed 1.2.1 + $t .sha256 (no hash delivered) -> warning, exit 0, old binary kept"
        ((TESTS_RUN++)); setup_test_env
        run_upgrade "1.2.1" "OK" "$t"
        if [[ $RUN_RC -eq 0 && "$RUN_KEPT" == "yes" && "$RUN_ASSET" == "no" ]] && grep -q "$SOFT_WARN" <<<"$RUN_ERR"; then pass "$test_name"
        else fail "$test_name" "rc=0, kept, asset not installed, warning" "rc=$RUN_RC kept=$RUN_KEPT asset=$RUN_ASSET err=$RUN_ERR"; fi
        teardown_test_env
    done
}

# @behavior D6(c) PR2-R3 item 3: with nothing installed, an unparseable .sha256 is still fatal (nothing to keep).
test_unparseable_checksum_without_binary_stays_hard() {
    local test_name="No binary + HTML .sha256 -> exit 1, nothing installed, no soft warning"
    ((TESTS_RUN++)); setup_test_env
    run_upgrade "none" "OK" "html"
    if [[ $RUN_RC -eq 1 && ! -e "$TEST_HOME/.oss/bin/oss-decrypt" ]] && ! grep -q "$SOFT_WARN" <<<"$RUN_ERR"; then pass "$test_name"
    else fail "$test_name" "rc=1, nothing installed, no soft warning" "rc=$RUN_RC err=$RUN_ERR"; fi
    teardown_test_env
}

# @behavior D6(c): with nothing usable installed, a download failure is still fatal (exit 1).
test_download_failure_without_runnable_binary_stays_hard() {
    local i
    for i in none broken; do
        local test_name="Installed=$i + asset download fails -> exit 1"
        ((TESTS_RUN++)); setup_test_env
        run_upgrade "$i" "BINFAIL" "none"
        if [[ $RUN_RC -eq 1 ]] && ! grep -q "$SOFT_WARN" <<<"$RUN_ERR"; then pass "$test_name"
        else fail "$test_name" "rc=1, no soft warning" "rc=$RUN_RC err=$RUN_ERR"; fi
        teardown_test_env
    done
}

# @behavior D6(d): a verified asset that reports below the floor is never installed (no re-download loop);
#           a working older binary is kept (warn, exit 0), with nothing installed it is fatal.
test_below_floor_asset_never_installed() {
    local test_name="Installed 1.2.1 + verified asset reporting 1.2.3 -> not installed, old kept, warning, exit 0"
    ((TESTS_RUN++)); setup_test_env
    run_upgrade "1.2.1" "OK" "none" "1.2.3"
    if [[ $RUN_RC -eq 0 && "$RUN_KEPT" == "yes" && "$RUN_ASSET" == "no" ]] && grep -q "$SOFT_WARN" <<<"$RUN_ERR"; then pass "$test_name"
    else fail "$test_name" "rc=0, kept, asset not installed, warning" "rc=$RUN_RC kept=$RUN_KEPT asset=$RUN_ASSET err=$RUN_ERR"; fi
    teardown_test_env
    test_name="No binary + verified asset reporting 1.2.3 -> not installed, exit 1"
    ((TESTS_RUN++)); setup_test_env
    run_upgrade "none" "OK" "none" "1.2.3"
    if [[ $RUN_RC -eq 1 && ! -e "$TEST_HOME/.oss/bin/oss-decrypt" ]]; then pass "$test_name"
    else fail "$test_name" "rc=1, nothing installed" "rc=$RUN_RC exists=$([[ -e "$TEST_HOME/.oss/bin/oss-decrypt" ]] && echo yes || echo no)"; fi
    teardown_test_env
}

# @behavior PR2-R3 item 4: only a binary that answers --version with exit 0 AND a version >= 1.2.1 (the old
#           floor) counts as a working install worth keeping. A binary that prints a version then fails, a crash
#           trace that happens to contain an X.Y.Z, or a pre-1.2.1 install is NOT kept on a failed download:
#           exit 1 (hard path) so the user is told, instead of a broken/ancient binary staying in service forever.
#           The outdated message names exactly one version (never a newline-joined "0.0.0").
test_unrunnable_or_ancient_install_takes_hard_path() {
    local label body
    for label in "prints-v1.2.1-then-exits-1" "crash-trace-with-node-v18.0.0" "prints-v0.9.0-exit-0"; do
        case "$label" in
            prints-v1.2.1-then-exits-1) body='echo "oss-decrypt v1.2.1"; exit 1' ;;
            crash-trace-with-node-v18.0.0) body='echo "node v18.0.0 crashed"; exit 1' ;;
            prints-v0.9.0-exit-0) body='echo "oss-decrypt v0.9.0"; exit 0' ;;
        esac
        local test_name="Installed binary $label + download fails -> exit 1, old file kept, no soft warning, one version in message"
        ((TESTS_RUN++)); setup_test_env
        run_upgrade "raw:$body" "FAIL" "none"
        if [[ $RUN_RC -eq 1 && "$RUN_KEPT" == "yes" ]] && ! grep -q "$SOFT_WARN" <<<"$RUN_ERR" \
            && ! grep -q '^0\.0\.0' <<<"$RUN_OUT"$'\n'"$RUN_ERR"; then pass "$test_name"
        else fail "$test_name" "rc=1, kept, no soft warning, no line starting 0.0.0" "rc=$RUN_RC kept=$RUN_KEPT out=$RUN_OUT err=$RUN_ERR"; fi
        teardown_test_env
    done
    # Control: a v1.2.1 binary that exits 0 is a working install -> soft path.
    local test_name="Control: installed v1.2.1 exiting 0 + download fails -> soft path, exit 0, kept"
    ((TESTS_RUN++)); setup_test_env
    run_upgrade 'raw:echo "oss-decrypt v1.2.1"; exit 0' "FAIL" "none"
    if [[ $RUN_RC -eq 0 && "$RUN_KEPT" == "yes" ]] && grep -q "$SOFT_WARN" <<<"$RUN_ERR"; then pass "$test_name"
    else fail "$test_name" "rc=0, kept, soft warning" "rc=$RUN_RC kept=$RUN_KEPT err=$RUN_ERR"; fi
    teardown_test_env
    # Only the FIRST X.Y.Z counts: a version line that also names a runtime is read as the oss-decrypt version.
    test_name="Installed 'oss-decrypt v1.2.1 (node v18.0.0)' exiting 0 + download fails -> message names v1.2.1 only, soft path"
    ((TESTS_RUN++)); setup_test_env
    run_upgrade 'raw:echo "oss-decrypt v1.2.1 (node v18.0.0)"; exit 0' "FAIL" "none"
    if [[ $RUN_RC -eq 0 && "$RUN_KEPT" == "yes" ]] && grep -qx 'oss-decrypt v1.2.1 is outdated (requires >= v1.2.4). Updating...' <<<"$RUN_OUT" \
        && ! grep -q '18\.0\.0' <<<"$RUN_OUT"; then pass "$test_name"
    else fail "$test_name" "rc=0, kept, outdated message names v1.2.1 only" "rc=$RUN_RC kept=$RUN_KEPT out=$RUN_OUT"; fi
    teardown_test_env
}

# @behavior D6(e) PR2-R3 item 1: the hook runs inside a ~120 s Bash tool call. Upgrading over a working binary
#           gets ONE deadline for the whole download so a slow-but-steady link fails INSIDE the hook and takes
#           the soft path (keep the old binary) instead of the tool killing the hook. The small .sha256 is fetched
#           FIRST with --max-time 15, then the binary with what is left of a 100 s budget (0 < cap <= 100).
#           (Round 2 put --max-time 90 on BOTH curls, binary first: worst case ~180 s + connect timeouts, past
#           the tool timeout, so the soft path never ran. That test asserted "--max-time 90" on the asset; it is
#           replaced by this one.) A first install has no cap and keeps its order (binary, then .sha256): it must finish.
test_upgrade_download_has_one_deadline_first_install_does_not() {
    local test_name="Installed 1.2.1 -> .sha256 first (--max-time 15), binary within the 100 s budget; no binary -> binary first, no cap"
    ((TESTS_RUN++)); setup_test_env
    local up_first up_bin up_cap fresh_first fresh_all up_rc fresh_rc
    export MOCK_CURL_ARGS_LOG="$TEST_HOME/curl.args"; run_upgrade "1.2.1" "OK" "none"; up_rc=$RUN_RC
    up_first=$(head -n1 "$MOCK_CURL_ARGS_LOG" 2>/dev/null)
    up_bin=$(grep -v '\.sha256 ' "$MOCK_CURL_ARGS_LOG" 2>/dev/null)
    up_cap=$(grep -oE -- '--max-time [0-9]+' <<<"$up_bin" | awk '{print $2}')
    teardown_test_env; setup_test_env
    export MOCK_CURL_ARGS_LOG="$TEST_HOME/curl.args"; run_upgrade "none" "OK" "none"; fresh_rc=$RUN_RC
    fresh_first=$(head -n1 "$MOCK_CURL_ARGS_LOG" 2>/dev/null)
    fresh_all=$(cat "$MOCK_CURL_ARGS_LOG" 2>/dev/null)
    unset MOCK_CURL_ARGS_LOG
    if [[ $up_rc -eq 0 && $fresh_rc -eq 0 \
        && "$up_first" == *".sha256 -o "* && $(grep -oc -- '--max-time' <<<"$up_first") -eq 1 && "$up_first" == *"--max-time 15 "* \
        && -n "$up_bin" && $(grep -c -- '--max-time' <<<"$up_bin") -eq 1 && "$up_cap" =~ ^[0-9]+$ && $up_cap -gt 0 && $up_cap -le 100 \
        && -n "$fresh_first" && "$fresh_first" != *".sha256 "* && "$fresh_all" != *"--max-time"* ]]; then pass "$test_name"
    else fail "$test_name" "upgrade: first curl .sha256 with one --max-time 15, binary curl one --max-time in (0,100]; first install: binary first, no --max-time" \
        "up_rc=$up_rc fresh_rc=$fresh_rc up_first=[$up_first] up_bin=[$up_bin] cap=[$up_cap] fresh=[$fresh_all]"; fi
    teardown_test_env
}

# =============================================================================
# PR2-R3 item 2: after a failed upgrade on the soft path, a stamp beside the binary
# (~/.oss/bin/.decrypt-upgrade-failed, "<epoch> <tag>") postpones further attempts for 6 h so a
# user on a slow link does not pay up to ~100 s on every /oss command. Same tag + < 6 h old + a
# runnable binary -> no curl at all, short stderr note, exit 0. Older, another tag, unparseable,
# no runnable binary -> try normally. A successful install removes the stamp; a hash mismatch
# (tamper, hard) never writes one; a symlink at the stamp path is never followed.
# =============================================================================
STAMP_REL=".oss/bin/.decrypt-upgrade-failed"
POSTPONE_NOTE="oss-decrypt update to cli-decrypt-v1.2.4 postponed"
# usage: curl_calls -> number of curl invocations recorded in $MOCK_CURL_ARGS_LOG
curl_calls() { local n; n=$(wc -l 2>/dev/null < "$MOCK_CURL_ARGS_LOG" | tr -d ' '); echo "${n:-0}"; }

# @behavior (a)+(b): a failed upgrade writes the stamp; the next command skips the download entirely.
test_failed_upgrade_postpones_next_attempt() {
    local test_name="Installed 1.2.1 + download fails -> stamp written, exit 0; next run: no curl, exit 0, kept, postponed note"
    ((TESTS_RUN++)); setup_test_env
    local stamp="$TEST_HOME/$STAMP_REL" a_rc stamp_ok=no
    export MOCK_CURL_ARGS_LOG="$TEST_HOME/curl.args"
    run_upgrade "1.2.1" "BINFAIL" "none"; a_rc=$RUN_RC
    [[ -f "$stamp" && ! -L "$stamp" ]] && grep -qE '^[0-9]+ cli-decrypt-v1\.2\.4$' "$stamp" && stamp_ok=yes
    rm -f "$MOCK_CURL_ARGS_LOG"
    run_upgrade "1.2.1" "OK" "none"
    local calls; calls=$(curl_calls); unset MOCK_CURL_ARGS_LOG
    if [[ $a_rc -eq 0 && "$stamp_ok" == "yes" && $RUN_RC -eq 0 && "$calls" == "0" && "$RUN_KEPT" == "yes" && "$RUN_ASSET" == "no" ]] \
        && grep -q "$POSTPONE_NOTE (last attempt failed [0-9]* min ago)" <<<"$RUN_ERR"; then pass "$test_name"
    else fail "$test_name" "a: rc 0 + stamp '<epoch> <tag>'; b: rc 0, 0 curl calls, kept, postponed note" \
        "a_rc=$a_rc stamp_ok=$stamp_ok [$(cat "$stamp" 2>/dev/null)] b_rc=$RUN_RC calls=$calls kept=$RUN_KEPT asset=$RUN_ASSET err=$RUN_ERR"; fi
    teardown_test_env
}

# @behavior (c)+(d)+defensive parse: a stale (> 6 h), other-tag, future-dated or unparseable stamp does not
#           postpone: the upgrade runs, installs the pinned asset and removes the stamp.
test_stale_or_foreign_stamp_does_not_postpone() {
    local label content now; now=$(date +%s)
    for label in older-than-6h other-tag future-dated non-numeric arith-injection; do
        case "$label" in
            older-than-6h) content="$((now - 6*3600 - 60)) cli-decrypt-v1.2.4" ;;
            other-tag) content="$now cli-decrypt-v1.2.3" ;;
            future-dated) content="$((now + 3600)) cli-decrypt-v1.2.4" ;;
            non-numeric) content="soon cli-decrypt-v1.2.4" ;;
            arith-injection) content='x[$(touch "$HOME/pwned")] cli-decrypt-v1.2.4' ;;
        esac
        local test_name="Installed 1.2.1 + $label stamp + working download -> upgraded, stamp removed"
        ((TESTS_RUN++)); setup_test_env
        mkdir -p "$TEST_HOME/.oss/bin"; echo "$content" > "$TEST_HOME/$STAMP_REL"
        export MOCK_CURL_ARGS_LOG="$TEST_HOME/curl.args"
        run_upgrade "1.2.1" "OK" "none"
        local calls; calls=$(curl_calls); unset MOCK_CURL_ARGS_LOG
        if [[ $RUN_RC -eq 0 && "$calls" != "0" && "$RUN_ASSET" == "yes" && ! -e "$TEST_HOME/$STAMP_REL" && ! -e "$TEST_HOME/pwned" ]] \
            && ! grep -q "postponed" <<<"$RUN_ERR"; then pass "$test_name"
        else fail "$test_name" "rc 0, curl called, asset installed, stamp gone, no postponed note" \
            "rc=$RUN_RC calls=$calls asset=$RUN_ASSET stamp=$(cat "$TEST_HOME/$STAMP_REL" 2>/dev/null) err=$RUN_ERR"; fi
        teardown_test_env
    done
}

# @behavior (e): a first install (no binary) ignores a fresh stamp and installs; the stamp is removed.
test_first_install_ignores_stamp() {
    local test_name="No binary + fresh stamp for the same tag -> install attempted and succeeds, stamp removed"
    ((TESTS_RUN++)); setup_test_env
    mkdir -p "$TEST_HOME/.oss/bin"; echo "$(date +%s) cli-decrypt-v1.2.4" > "$TEST_HOME/$STAMP_REL"
    export MOCK_CURL_ARGS_LOG="$TEST_HOME/curl.args"
    run_upgrade "none" "OK" "none"
    local calls; calls=$(curl_calls); unset MOCK_CURL_ARGS_LOG
    if [[ $RUN_RC -eq 0 && "$calls" != "0" && "$RUN_ASSET" == "yes" && ! -e "$TEST_HOME/$STAMP_REL" ]]; then pass "$test_name"
    else fail "$test_name" "rc 0, curl called, installed, stamp removed" "rc=$RUN_RC calls=$calls asset=$RUN_ASSET err=$RUN_ERR"; fi
    teardown_test_env
}

# @behavior (f): tampering (hash mismatch) is hard and never postpones the next attempt.
test_hash_mismatch_writes_no_stamp() {
    local t
    for t in release committed; do
        local test_name="Installed 1.2.1 + $t hash mismatch -> exit 1, no stamp written"
        ((TESTS_RUN++)); setup_test_env
        run_upgrade "1.2.1" "OK" "$t"
        if [[ $RUN_RC -eq 1 && ! -e "$TEST_HOME/$STAMP_REL" ]]; then pass "$test_name"
        else fail "$test_name" "rc 1, no stamp" "rc=$RUN_RC stamp=$(cat "$TEST_HOME/$STAMP_REL" 2>/dev/null)"; fi
        teardown_test_env
    done
}

# @behavior (g): a symlink at the stamp path is never followed: its target is not overwritten and it
#           does not postpone (a planted link cannot switch off upgrades).
test_stamp_symlink_never_followed() {
    local test_name="Stamp path is a symlink -> target unchanged after a failed upgrade; link does not postpone"
    ((TESTS_RUN++)); setup_test_env
    mkdir -p "$TEST_HOME/.oss/bin"; local target="$TEST_HOME/victim"
    echo "precious" > "$target"; ln -s "$target" "$TEST_HOME/$STAMP_REL"
    run_upgrade "1.2.1" "BINFAIL" "none"; local a_rc=$RUN_RC a_target; a_target=$(cat "$target")
    # A link pointing at a fresh, well-formed stamp must not postpone either.
    echo "$(date +%s) cli-decrypt-v1.2.4" > "$target"
    export MOCK_CURL_ARGS_LOG="$TEST_HOME/curl.args"
    run_upgrade "1.2.1" "OK" "none"
    local calls; calls=$(curl_calls); unset MOCK_CURL_ARGS_LOG
    if [[ $a_rc -eq 0 && "$a_target" == "precious" && $RUN_RC -eq 0 && "$calls" != "0" && "$RUN_ASSET" == "yes" ]]; then pass "$test_name"
    else fail "$test_name" "rc 0, target still 'precious'; link ignored -> upgrade attempted and installed" \
        "a_rc=$a_rc target=[$a_target] b_rc=$RUN_RC calls=$calls asset=$RUN_ASSET err=$RUN_ERR"; fi
    teardown_test_env
}

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
test_aarch64_installs_arm64_binary
test_setup_failure_no_false_ready
test_default_download_is_pinned_tag
test_tag_override
test_committed_hash_match_installs
test_committed_hash_mismatch_rejects
test_committed_manifest_missing_entry_rejects
test_manifest_found_via_plugin_root
test_download_never_written_to_final_path
test_failed_update_keeps_working_binary
test_curl_flags_hardened
test_invalid_tag_rejected_without_network
test_failures_do_not_loop_to_login
test_manifest_found_beside_hook
test_committed_manifest_is_complete_and_matches_tag
test_stale_temp_files_swept_fresh_kept
test_interrupted_checksum_download_leaves_no_temp_file
test_failed_second_mktemp_leaves_nothing
test_pinned_tag_matches_cli_package_version
test_committed_checksums_header_names_pinned_tag
test_v121_install_is_upgraded_to_pinned
test_v123_install_is_upgraded_to_pinned
test_v124_install_kept_without_download
test_pinned_asset_not_redownloaded_on_next_run
test_asset_download_failure_keeps_runnable_binary
test_checksum_download_failure_keeps_runnable_binary
test_hash_mismatch_with_old_binary_stays_hard
test_unparseable_checksum_with_runnable_binary_is_soft
test_unparseable_checksum_without_binary_stays_hard
test_download_failure_without_runnable_binary_stays_hard
test_below_floor_asset_never_installed
test_upgrade_download_has_one_deadline_first_install_does_not
test_unrunnable_or_ancient_install_takes_hard_path
test_failed_upgrade_postpones_next_attempt
test_stale_or_foreign_stamp_does_not_postpone
test_first_install_ignores_stamp
test_hash_mismatch_writes_no_stamp
test_stamp_symlink_never_followed

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
