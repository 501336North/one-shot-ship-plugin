#!/bin/bash
# Tests for oss-iron-laws-sync.sh - Iron Laws session-start freshness sync
#
# Usage: ./iron-laws-sync.test.sh
#
# Tests:
# 1. Should exit 0 when CLAUDE.md has fresh Iron Laws (cache <24h)
# 2. Should fetch the laws through the decrypt CLI (never curl) when the cache is >24h old
# 3. --install should create Iron Laws section when CLAUDE.md exists but has no markers
# 4. --install should create CLAUDE.md from scratch when file missing
# 5. --install should output Iron Laws to stdout when CLAUDE.md was missing
# (Session start never creates or appends: see iron-laws-sync-safety.test.sh)
# 6. Should NOT output to stdout when CLAUDE.md already has Iron Laws
# 7. Should update Iron Laws between markers when hash differs

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/../oss-iron-laws-sync.sh"

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

# The laws reach the hook only through the decrypt CLI (FR15): the CLI checks them against the signed
# manifest and prints them, or refuses. These helpers stub it at $TEST_HOME/.oss/bin/oss-decrypt.
# $1 (the PATH dir) gets a curl that records any call to $TEST_HOME/curl-called and fails: the hook
# must never fetch the laws itself.
create_curl_tripwire() {
    local mock_dir="$1"
    cat > "$mock_dir/curl" << CURLEOF
#!/bin/bash
echo "\$*" >> "$TEST_HOME/curl-called"
exit 7
CURLEOF
    chmod +x "$mock_dir/curl"
}

# Helper: a stub oss-decrypt that prints verified Iron Laws content
create_mock_cli() {
    local mock_dir="$1"
    local iron_laws_content="${2:-# IRON LAWS\n\n## LAW 1: TDD\nNo code without tests.}"
    create_tracking_mock_cli "$mock_dir" "" "$iron_laws_content"
}

# Helper: a stub oss-decrypt that records its arguments to $2 (when given) and prints the laws
create_tracking_mock_cli() {
    local mock_dir="$1"
    local marker_file="$2"
    local iron_laws_content="${3:-# IRON LAWS - UPDATED\n\n## LAW 1: TDD}"
    create_curl_tripwire "$mock_dir"
    mkdir -p "$TEST_HOME/.oss/bin"
    cat > "$TEST_HOME/.oss/bin/oss-decrypt" << CLIEOF
#!/bin/bash
[[ -n "$marker_file" ]] && echo "\$*" > "$marker_file"
echo -e "$iron_laws_content"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo "IRON LAW padding line \$i: a real laws body is several KB, the sync rejects anything under 500 bytes."; done
CLIEOF
    chmod +x "$TEST_HOME/.oss/bin/oss-decrypt"
}

# =============================================================================
# TEST 1: Should exit 0 when CLAUDE.md has fresh Iron Laws (cache <24h)
#
# @behavior Skips API call when Iron Laws are fresh
# @business-rule Avoid unnecessary API calls during session start
# =============================================================================
test_fresh_cache_skips_fetch() {
    local test_name="Should exit 0 when CLAUDE.md has fresh Iron Laws (cache <24h)"
    ((TESTS_RUN++))

    TEST_HOME=$(mktemp -d)
    TEST_PROJECT=$(mktemp -d)

    # Create config with API key
    mkdir -p "$TEST_HOME/.oss"
    echo '{"apiKey": "test-key-123"}' > "$TEST_HOME/.oss/config.json"

    # Create CLAUDE.md with Iron Laws markers
    cat > "$TEST_PROJECT/CLAUDE.md" << 'EOF'
# My Project

<!-- IRON LAWS START - Do not edit manually, updated by /oss:login -->
# IRON LAWS
## LAW 1: TDD
<!-- IRON LAWS END -->
EOF

    # Create fresh cache file (touched now = <24h old)
    echo "abc123" > "$TEST_HOME/.oss/.iron-laws-hash"
    touch "$TEST_HOME/.oss/.iron-laws-last-check"

    # The decrypt CLI should NOT be called
    MOCK_BIN_DIR=$(mktemp -d)
    local marker_file="$TEST_HOME/cli-called"
    create_tracking_mock_cli "$MOCK_BIN_DIR" "$marker_file"

    local result exit_code=0
    result=$(HOME="$TEST_HOME" CLAUDE_PROJECT_DIR="$TEST_PROJECT" PATH="$MOCK_BIN_DIR:$PATH" "$HOOK_SCRIPT" 2>&1) || exit_code=$?

    local cli_called=false
    [[ -f "$marker_file" ]] && cli_called=true

    rm -rf "$TEST_HOME" "$TEST_PROJECT" "$MOCK_BIN_DIR"

    if [[ $exit_code -eq 0 ]] && [[ "$cli_called" == "false" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0, no CLI call" "exit=$exit_code cli_called=$cli_called output=$result"
    fi
}

# =============================================================================
# TEST 2: Should fetch from API when hash file is >24h old
#
# @behavior Refreshes Iron Laws when cache is stale
# @business-rule Keep Iron Laws up-to-date with latest from API
# =============================================================================
test_stale_cache_fetches() {
    local test_name="Should fetch the laws through the decrypt CLI (never curl) when the cache is >24h old"
    ((TESTS_RUN++))

    TEST_HOME=$(mktemp -d)
    TEST_PROJECT=$(mktemp -d)

    mkdir -p "$TEST_HOME/.oss"
    echo '{"apiKey": "test-key-123"}' > "$TEST_HOME/.oss/config.json"

    # Create CLAUDE.md with Iron Laws markers
    cat > "$TEST_PROJECT/CLAUDE.md" << 'EOF'
# My Project

<!-- IRON LAWS START - Do not edit manually, updated by /oss:login -->
# OLD IRON LAWS
<!-- IRON LAWS END -->
EOF

    # Create stale cache file (>24h old)
    echo "old-hash" > "$TEST_HOME/.oss/.iron-laws-hash"
    touch -t 202601010000 "$TEST_HOME/.oss/.iron-laws-last-check"

    # Tracking stub CLI
    MOCK_BIN_DIR=$(mktemp -d)
    local marker_file="$TEST_HOME/cli-called"
    create_tracking_mock_cli "$MOCK_BIN_DIR" "$marker_file"

    local result exit_code=0
    result=$(HOME="$TEST_HOME" CLAUDE_PROJECT_DIR="$TEST_PROJECT" PATH="$MOCK_BIN_DIR:$PATH" "$HOOK_SCRIPT" 2>&1) || exit_code=$?

    local cli_args="" curl_called=false
    [[ -f "$marker_file" ]] && cli_args=$(cat "$marker_file")
    [[ -f "$TEST_HOME/curl-called" ]] && curl_called=true

    rm -rf "$TEST_HOME" "$TEST_PROJECT" "$MOCK_BIN_DIR"

    if [[ $exit_code -eq 0 ]] && [[ "$cli_args" == "--type shared --name iron-laws" ]] && [[ "$curl_called" == "false" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0, CLI called with --type shared --name iron-laws, no curl" "exit=$exit_code cli_args=$cli_args curl_called=$curl_called output=$result"
    fi
}

# =============================================================================
# TEST 3: Should create Iron Laws section when CLAUDE.md exists but has no markers
#
# @behavior Appends Iron Laws with markers to existing CLAUDE.md
# @business-rule Preserve user's existing CLAUDE.md content
# =============================================================================
test_missing_markers_appends() {
    local test_name="--install should create Iron Laws section when markers missing"
    ((TESTS_RUN++))

    TEST_HOME=$(mktemp -d)
    TEST_PROJECT=$(mktemp -d)

    mkdir -p "$TEST_HOME/.oss"
    echo '{"apiKey": "test-key-123"}' > "$TEST_HOME/.oss/config.json"

    # CLAUDE.md exists but has NO Iron Laws markers
    cat > "$TEST_PROJECT/CLAUDE.md" << 'EOF'
# My Project

Some custom content here.
EOF

    # No cache files exist
    MOCK_BIN_DIR=$(mktemp -d)
    create_mock_cli "$MOCK_BIN_DIR"

    local result exit_code=0
    result=$(HOME="$TEST_HOME" CLAUDE_PROJECT_DIR="$TEST_PROJECT" PATH="$MOCK_BIN_DIR:$PATH" "$HOOK_SCRIPT" --install 2>&1) || exit_code=$?

    # Check CLAUDE.md now has markers AND preserved original content
    local has_markers=false has_original=false
    grep -q "IRON LAWS START" "$TEST_PROJECT/CLAUDE.md" 2>/dev/null && has_markers=true
    grep -q "Some custom content" "$TEST_PROJECT/CLAUDE.md" 2>/dev/null && has_original=true

    rm -rf "$TEST_HOME" "$TEST_PROJECT" "$MOCK_BIN_DIR"

    if [[ $exit_code -eq 0 ]] && [[ "$has_markers" == "true" ]] && [[ "$has_original" == "true" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0, markers added, original preserved" "exit=$exit_code markers=$has_markers original=$has_original"
    fi
}

# =============================================================================
# TEST 4: Should create CLAUDE.md from scratch when file missing
#
# @behavior Creates new CLAUDE.md with Iron Laws section
# @business-rule First-time users get Iron Laws automatically
# =============================================================================
test_missing_claude_md_creates() {
    local test_name="--install should create CLAUDE.md from scratch when file missing"
    ((TESTS_RUN++))

    TEST_HOME=$(mktemp -d)
    TEST_PROJECT=$(mktemp -d)

    mkdir -p "$TEST_HOME/.oss"
    echo '{"apiKey": "test-key-123"}' > "$TEST_HOME/.oss/config.json"

    # No CLAUDE.md exists
    MOCK_BIN_DIR=$(mktemp -d)
    create_mock_cli "$MOCK_BIN_DIR"

    local result exit_code=0
    result=$(HOME="$TEST_HOME" CLAUDE_PROJECT_DIR="$TEST_PROJECT" PATH="$MOCK_BIN_DIR:$PATH" "$HOOK_SCRIPT" --install 2>&1) || exit_code=$?

    local file_exists=false has_markers=false
    [[ -f "$TEST_PROJECT/CLAUDE.md" ]] && file_exists=true
    grep -q "IRON LAWS START" "$TEST_PROJECT/CLAUDE.md" 2>/dev/null && has_markers=true

    rm -rf "$TEST_HOME" "$TEST_PROJECT" "$MOCK_BIN_DIR"

    if [[ $exit_code -eq 0 ]] && [[ "$file_exists" == "true" ]] && [[ "$has_markers" == "true" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0, CLAUDE.md created with markers" "exit=$exit_code exists=$file_exists markers=$has_markers"
    fi
}

# =============================================================================
# TEST 5: Should output Iron Laws to stdout when CLAUDE.md was missing
#
# @behavior Outputs to stdout as fallback for current session
# @business-rule Current session gets Iron Laws even if CLAUDE.md just created
# =============================================================================
test_stdout_fallback_when_created() {
    local test_name="--install should output Iron Laws to stdout when CLAUDE.md was missing"
    ((TESTS_RUN++))

    TEST_HOME=$(mktemp -d)
    TEST_PROJECT=$(mktemp -d)

    mkdir -p "$TEST_HOME/.oss"
    echo '{"apiKey": "test-key-123"}' > "$TEST_HOME/.oss/config.json"

    # No CLAUDE.md exists
    MOCK_BIN_DIR=$(mktemp -d)
    create_mock_cli "$MOCK_BIN_DIR"

    local result exit_code=0
    result=$(HOME="$TEST_HOME" CLAUDE_PROJECT_DIR="$TEST_PROJECT" PATH="$MOCK_BIN_DIR:$PATH" "$HOOK_SCRIPT" --install 2>&1) || exit_code=$?

    rm -rf "$TEST_HOME" "$TEST_PROJECT" "$MOCK_BIN_DIR"

    if [[ $exit_code -eq 0 ]] && echo "$result" | grep -q "IRON LAWS"; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0, stdout contains IRON LAWS" "exit=$exit_code stdout=$result"
    fi
}

# =============================================================================
# TEST 6: Should NOT output to stdout when CLAUDE.md already has Iron Laws
#
# @behavior No stdout when Iron Laws already in CLAUDE.md
# @business-rule Avoid duplicating Iron Laws in context
# =============================================================================
test_no_stdout_when_existing() {
    local test_name="Should NOT output to stdout when CLAUDE.md already has Iron Laws"
    ((TESTS_RUN++))

    TEST_HOME=$(mktemp -d)
    TEST_PROJECT=$(mktemp -d)

    mkdir -p "$TEST_HOME/.oss"
    echo '{"apiKey": "test-key-123"}' > "$TEST_HOME/.oss/config.json"

    # CLAUDE.md already has Iron Laws
    cat > "$TEST_PROJECT/CLAUDE.md" << 'EOF'
# My Project

<!-- IRON LAWS START - Do not edit manually, updated by /oss:login -->
# IRON LAWS
## LAW 1: TDD
<!-- IRON LAWS END -->
EOF

    # Fresh cache
    echo "abc123" > "$TEST_HOME/.oss/.iron-laws-hash"
    touch "$TEST_HOME/.oss/.iron-laws-last-check"

    MOCK_BIN_DIR=$(mktemp -d)
    create_mock_cli "$MOCK_BIN_DIR"

    local result exit_code=0
    result=$(HOME="$TEST_HOME" CLAUDE_PROJECT_DIR="$TEST_PROJECT" PATH="$MOCK_BIN_DIR:$PATH" "$HOOK_SCRIPT" 2>&1) || exit_code=$?

    rm -rf "$TEST_HOME" "$TEST_PROJECT" "$MOCK_BIN_DIR"

    # stdout should NOT contain IRON LAWS (it's already in CLAUDE.md)
    if [[ $exit_code -eq 0 ]] && ! echo "$result" | grep -q "IRON LAWS"; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0, NO Iron Laws in stdout" "exit=$exit_code stdout=$result"
    fi
}

# =============================================================================
# TEST 7: Should update Iron Laws between markers when hash differs
#
# @behavior Replaces content between markers with fresh API content
# @business-rule Keep Iron Laws up-to-date without losing user content
# =============================================================================
test_update_between_markers() {
    local test_name="Should update Iron Laws between markers when hash differs"
    ((TESTS_RUN++))

    TEST_HOME=$(mktemp -d)
    TEST_PROJECT=$(mktemp -d)

    mkdir -p "$TEST_HOME/.oss"
    echo '{"apiKey": "test-key-123"}' > "$TEST_HOME/.oss/config.json"

    # CLAUDE.md with OLD Iron Laws
    cat > "$TEST_PROJECT/CLAUDE.md" << 'EOF'
# My Project

Custom content above.

<!-- IRON LAWS START - Do not edit manually, updated by /oss:login -->
# OLD IRON LAWS
This is outdated.
<!-- IRON LAWS END -->

Custom content below.
EOF

    # Stale cache (force fetch)
    echo "old-hash" > "$TEST_HOME/.oss/.iron-laws-hash"
    touch -t 202601010000 "$TEST_HOME/.oss/.iron-laws-last-check"

    # The CLI prints UPDATED content
    MOCK_BIN_DIR=$(mktemp -d)
    create_mock_cli "$MOCK_BIN_DIR" "# IRON LAWS - UPDATED VERSION\n\n## LAW 1: TDD is mandatory"

    local result exit_code=0
    result=$(HOME="$TEST_HOME" CLAUDE_PROJECT_DIR="$TEST_PROJECT" PATH="$MOCK_BIN_DIR:$PATH" "$HOOK_SCRIPT" 2>&1) || exit_code=$?

    # Check CLAUDE.md has new content and preserved surrounding content
    local has_updated=false has_above=false has_below=false has_old=true
    grep -q "UPDATED VERSION" "$TEST_PROJECT/CLAUDE.md" 2>/dev/null && has_updated=true
    grep -q "Custom content above" "$TEST_PROJECT/CLAUDE.md" 2>/dev/null && has_above=true
    grep -q "Custom content below" "$TEST_PROJECT/CLAUDE.md" 2>/dev/null && has_below=true
    grep -q "This is outdated" "$TEST_PROJECT/CLAUDE.md" 2>/dev/null || has_old=false

    rm -rf "$TEST_HOME" "$TEST_PROJECT" "$MOCK_BIN_DIR"

    if [[ $exit_code -eq 0 ]] && [[ "$has_updated" == "true" ]] && [[ "$has_above" == "true" ]] && [[ "$has_below" == "true" ]] && [[ "$has_old" == "false" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0, updated content, preserved surrounding, removed old" "exit=$exit_code updated=$has_updated above=$has_above below=$has_below old_removed=$(! $has_old && echo true || echo false)"
    fi
}


# =============================================================================
# TEST 8: Refresh keeps the user's last line when CLAUDE.md has no trailing newline
#
# @behavior A stale-cache refresh never deletes the user's own CLAUDE.md content
# @business-rule Iron Laws sync owns only the text between its markers; editors that omit
#                the final newline must not cost the user their last line
# =============================================================================
test_refresh_keeps_last_line_without_newline() {
    local test_name="Refresh keeps user's last line when CLAUDE.md lacks a trailing newline"
    ((TESTS_RUN++))

    TEST_HOME=$(mktemp -d)
    TEST_PROJECT=$(mktemp -d)
    mkdir -p "$TEST_HOME/.oss"
    echo '{"apiKey": "test-key-123"}' > "$TEST_HOME/.oss/config.json"

    printf '%s\n' "# My Project" "" \
        "<!-- IRON LAWS START - Do not edit manually, updated by /oss:login -->" \
        "# OLD IRON LAWS" "<!-- IRON LAWS END -->" "" > "$TEST_PROJECT/CLAUDE.md"
    printf '%s' "My final rule, no newline" >> "$TEST_PROJECT/CLAUDE.md"
    touch -t 202601010000 "$TEST_HOME/.oss/.iron-laws-last-check"

    MOCK_BIN_DIR=$(mktemp -d)
    create_mock_cli "$MOCK_BIN_DIR" "# IRON LAWS - FRESH"

    local exit_code=0
    HOME="$TEST_HOME" CLAUDE_PROJECT_DIR="$TEST_PROJECT" PATH="$MOCK_BIN_DIR:$PATH" "$HOOK_SCRIPT" >/dev/null 2>&1 || exit_code=$?

    local has_fresh=false has_last=false
    grep -q "IRON LAWS - FRESH" "$TEST_PROJECT/CLAUDE.md" && has_fresh=true
    grep -q "My final rule, no newline" "$TEST_PROJECT/CLAUDE.md" && has_last=true

    rm -rf "$TEST_HOME" "$TEST_PROJECT" "$MOCK_BIN_DIR"

    if [[ $exit_code -eq 0 && "$has_fresh" == "true" && "$has_last" == "true" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0, fresh laws, user's last line kept" "exit=$exit_code fresh=$has_fresh last_line_kept=$has_last"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running oss-iron-laws-sync.sh tests..."
echo "======================================="

test_fresh_cache_skips_fetch
test_stale_cache_fetches
test_missing_markers_appends
test_missing_claude_md_creates
test_stdout_fallback_when_created
test_no_stdout_when_existing
test_update_between_markers
test_refresh_keeps_last_line_without_newline

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
