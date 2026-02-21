#!/bin/bash
# Tests for WorktreeCreate/WorktreeRemove hook handlers
#
# Usage: ./worktree-hooks.test.sh
#
# Tests:
# 1. hooks.json should register WorktreeCreate handler
# 2. hooks.json should register WorktreeRemove handler
# 3. oss-worktree-create.sh should create .oss/ directory in worktree
# 4. oss-worktree-create.sh should initialize workflow-state.json
# 5. oss-worktree-create.sh should copy config from home directory
# 6. oss-worktree-remove.sh should clean up .oss/ in worktree
# 7. oss-worktree-remove.sh should preserve dev docs

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_JSON="$SCRIPT_DIR/../hooks.json"
CREATE_SCRIPT="$SCRIPT_DIR/../oss-worktree-create.sh"
REMOVE_SCRIPT="$SCRIPT_DIR/../oss-worktree-remove.sh"

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
# TEST 1: hooks.json should register WorktreeCreate handler
#
# @behavior Plugin registers for worktree lifecycle events
# @acceptance-criteria hooks.json has WorktreeCreate key with command
# =============================================================================
test_hooks_json_worktree_create() {
    local test_name="hooks.json should register WorktreeCreate handler"
    ((TESTS_RUN++))

    if [[ ! -f "$HOOKS_JSON" ]]; then
        fail "$test_name" "hooks.json exists" "file not found"
        return
    fi

    local has_key
    has_key=$(jq 'has("hooks") and (.hooks | has("WorktreeCreate"))' "$HOOKS_JSON" 2>/dev/null)

    if [[ "$has_key" == "true" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "WorktreeCreate key in hooks" "key not found"
    fi
}

# =============================================================================
# TEST 2: hooks.json should register WorktreeRemove handler
#
# @behavior Plugin registers for worktree lifecycle events
# @acceptance-criteria hooks.json has WorktreeRemove key with command
# =============================================================================
test_hooks_json_worktree_remove() {
    local test_name="hooks.json should register WorktreeRemove handler"
    ((TESTS_RUN++))

    if [[ ! -f "$HOOKS_JSON" ]]; then
        fail "$test_name" "hooks.json exists" "file not found"
        return
    fi

    local has_key
    has_key=$(jq 'has("hooks") and (.hooks | has("WorktreeRemove"))' "$HOOKS_JSON" 2>/dev/null)

    if [[ "$has_key" == "true" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "WorktreeRemove key in hooks" "key not found"
    fi
}

# =============================================================================
# TEST 3: oss-worktree-create.sh should create .oss/ directory in worktree
#
# @behavior New worktrees get their own .oss/ state directory
# @acceptance-criteria .oss/ directory created at CLAUDE_WORKTREE_PATH
# =============================================================================
test_create_oss_dir() {
    local test_name="oss-worktree-create.sh should create .oss/ directory in worktree"
    ((TESTS_RUN++))

    if [[ ! -f "$CREATE_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found: $CREATE_SCRIPT"
        return
    fi

    local test_dir
    test_dir=$(mktemp -d)
    local test_home
    test_home=$(mktemp -d)
    mkdir -p "$test_home/.oss"
    echo '{"apiKey":"test-key"}' > "$test_home/.oss/config.json"

    CLAUDE_WORKTREE_PATH="$test_dir" HOME="$test_home" "$CREATE_SCRIPT" 2>/dev/null

    if [[ -d "$test_dir/.oss" ]]; then
        pass "$test_name"
    else
        fail "$test_name" ".oss/ directory exists" "directory not found"
    fi

    rm -rf "$test_dir" "$test_home"
}

# =============================================================================
# TEST 4: oss-worktree-create.sh should initialize workflow-state.json
#
# @behavior Worktree gets its own workflow state for independent tracking
# @acceptance-criteria workflow-state.json exists with valid JSON
# =============================================================================
test_create_workflow_state() {
    local test_name="oss-worktree-create.sh should initialize workflow-state.json"
    ((TESTS_RUN++))

    if [[ ! -f "$CREATE_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(mktemp -d)
    local test_home
    test_home=$(mktemp -d)
    mkdir -p "$test_home/.oss"
    echo '{"apiKey":"test-key"}' > "$test_home/.oss/config.json"

    CLAUDE_WORKTREE_PATH="$test_dir" HOME="$test_home" "$CREATE_SCRIPT" 2>/dev/null

    if [[ -f "$test_dir/.oss/workflow-state.json" ]] && jq empty "$test_dir/.oss/workflow-state.json" 2>/dev/null; then
        pass "$test_name"
    else
        fail "$test_name" "valid workflow-state.json" "file missing or invalid JSON"
    fi

    rm -rf "$test_dir" "$test_home"
}

# =============================================================================
# TEST 5: oss-worktree-create.sh should copy config from home
#
# @behavior Auth credentials are shared across worktrees
# @acceptance-criteria config.json copied from ~/.oss/ to worktree .oss/
# =============================================================================
test_copy_config() {
    local test_name="oss-worktree-create.sh should copy config from home directory"
    ((TESTS_RUN++))

    if [[ ! -f "$CREATE_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(mktemp -d)
    local test_home
    test_home=$(mktemp -d)
    mkdir -p "$test_home/.oss"
    echo '{"apiKey":"test-key-12345"}' > "$test_home/.oss/config.json"

    CLAUDE_WORKTREE_PATH="$test_dir" HOME="$test_home" "$CREATE_SCRIPT" 2>/dev/null

    if [[ -f "$test_dir/.oss/config.json" ]]; then
        local copied_key
        copied_key=$(grep -o 'test-key-12345' "$test_dir/.oss/config.json" || true)
        if [[ -n "$copied_key" ]]; then
            pass "$test_name"
        else
            fail "$test_name" "config with API key" "config exists but key missing"
        fi
    else
        fail "$test_name" "config.json copied" "file not found"
    fi

    rm -rf "$test_dir" "$test_home"
}

# =============================================================================
# TEST 6: oss-worktree-remove.sh should clean up .oss/ state
#
# @behavior Worktree cleanup removes state files to avoid clutter
# @acceptance-criteria workflow-state.json removed after cleanup
# =============================================================================
test_remove_cleanup() {
    local test_name="oss-worktree-remove.sh should clean up .oss/ state"
    ((TESTS_RUN++))

    if [[ ! -f "$REMOVE_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found: $REMOVE_SCRIPT"
        return
    fi

    local test_dir
    test_dir=$(mktemp -d)
    mkdir -p "$test_dir/.oss"
    echo '{}' > "$test_dir/.oss/workflow-state.json"
    echo '{}' > "$test_dir/.oss/config.json"

    CLAUDE_WORKTREE_PATH="$test_dir" "$REMOVE_SCRIPT" 2>/dev/null

    if [[ ! -f "$test_dir/.oss/workflow-state.json" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "workflow-state.json removed" "file still exists"
    fi

    rm -rf "$test_dir"
}

# =============================================================================
# TEST 7: oss-worktree-remove.sh should preserve dev docs
#
# @behavior Dev docs are preserved (not deleted) during worktree cleanup
# @acceptance-criteria .oss/dev/ directory contents survive cleanup
# =============================================================================
test_preserve_dev_docs() {
    local test_name="oss-worktree-remove.sh should preserve dev docs"
    ((TESTS_RUN++))

    if [[ ! -f "$REMOVE_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(mktemp -d)
    mkdir -p "$test_dir/.oss/dev/active/my-feature"
    echo "# Progress" > "$test_dir/.oss/dev/active/my-feature/PROGRESS.md"
    echo '{}' > "$test_dir/.oss/workflow-state.json"

    CLAUDE_WORKTREE_PATH="$test_dir" "$REMOVE_SCRIPT" 2>/dev/null

    if [[ -f "$test_dir/.oss/dev/active/my-feature/PROGRESS.md" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "dev docs preserved" "PROGRESS.md deleted"
    fi

    rm -rf "$test_dir"
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running worktree hooks tests..."
echo "======================================="

test_hooks_json_worktree_create
test_hooks_json_worktree_remove
test_create_oss_dir
test_create_workflow_state
test_copy_config
test_remove_cleanup
test_preserve_dev_docs

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
