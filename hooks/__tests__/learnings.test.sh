#!/bin/bash
# Tests for two-tier LEARNINGS.md system (Competitive Edge Pack - Feature B)
#
# @behavior Learnings are captured at two scopes (global + project) with guardrails
# @business-rule Quality gate prevents noise; dedup prevents duplicates
#
# Usage: ./learnings.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRITE_SCRIPT="$SCRIPT_DIR/../oss-write-learning.sh"
CONTEXT_SCRIPT="$SCRIPT_DIR/../oss-context-inject.sh"

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
    mkdir -p "$test_dir/project"
    mkdir -p "$test_dir/global"
    # Init a git repo in the project dir for context-inject
    (cd "$test_dir/project" && git init -q && git commit --allow-empty -m "init" -q 2>/dev/null) || true
    echo "$test_dir"
}

cleanup_test_env() {
    rm -rf "$1"
}

# =============================================================================
# TEST 1: Should create LEARNINGS.md if it does not exist
#
# @behavior First learning creates the file with header
# @acceptance-criteria AC-002.1
# =============================================================================
test_create_learnings_file() {
    local test_name="Should create LEARNINGS.md if it does not exist"
    ((TESTS_RUN++))

    if [[ ! -f "$WRITE_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found: $WRITE_SCRIPT"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    local exit_code=0
    "$WRITE_SCRIPT" \
        --scope project \
        --category "DB" \
        --context "build, packages/database" \
        --learning "Always run prisma generate before prisma migrate for new enum types" \
        --project-root "$test_dir/project" \
        --global-root "$test_dir/global" \
        2>&1 || exit_code=$?

    if [[ -f "$test_dir/project/LEARNINGS.md" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "LEARNINGS.md created" "file not found (exit: $exit_code)"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 2: Should append entry in correct format
#
# @behavior Learning entry has date, category, context, learning text
# @acceptance-criteria AC-002.4
# =============================================================================
test_correct_format() {
    local test_name="Should append entry in correct format"
    ((TESTS_RUN++))

    if [[ ! -f "$WRITE_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    "$WRITE_SCRIPT" \
        --scope project \
        --category "Testing" \
        --context "build, packages/api" \
        --learning "Use unique emails per test to avoid flaky shared state" \
        --project-root "$test_dir/project" \
        --global-root "$test_dir/global" \
        2>&1

    local content
    content=$(cat "$test_dir/project/LEARNINGS.md" 2>/dev/null)

    # Check required format elements
    local has_date has_category has_context has_learning
    has_date=$(echo "$content" | grep -c "\[20[0-9][0-9]-" || true)
    has_category=$(echo "$content" | grep -c "Testing" || true)
    has_context=$(echo "$content" | grep -c "build, packages/api" || true)
    has_learning=$(echo "$content" | grep -c "unique emails per test" || true)

    if [[ $has_date -gt 0 && $has_category -gt 0 && $has_context -gt 0 && $has_learning -gt 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "date, category, context, and learning in entry" "content: '$content'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 3: Should reject duplicate entries
#
# @behavior Same learning text is not written twice
# @acceptance-criteria AC-002.2
# =============================================================================
test_dedup() {
    local test_name="Should reject duplicate entries"
    ((TESTS_RUN++))

    if [[ ! -f "$WRITE_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Write first entry
    "$WRITE_SCRIPT" \
        --scope project \
        --category "DB" \
        --context "build, packages/database" \
        --learning "Always run prisma generate before migrate" \
        --project-root "$test_dir/project" \
        --global-root "$test_dir/global" \
        2>&1

    local line_count_before
    line_count_before=$(wc -l < "$test_dir/project/LEARNINGS.md")

    # Write duplicate
    local exit_code=0
    "$WRITE_SCRIPT" \
        --scope project \
        --category "DB" \
        --context "build, packages/database" \
        --learning "Always run prisma generate before migrate" \
        --project-root "$test_dir/project" \
        --global-root "$test_dir/global" \
        2>&1 || exit_code=$?

    local line_count_after
    line_count_after=$(wc -l < "$test_dir/project/LEARNINGS.md")

    if [[ "$line_count_before" -eq "$line_count_after" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "same line count ($line_count_before)" "line count changed to $line_count_after"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 4: Should write to global file when scope is global
#
# @behavior Global learnings go to ~/.oss/LEARNINGS.md equivalent
# @acceptance-criteria AC-003.1
# =============================================================================
test_global_scope() {
    local test_name="Should write to global file when scope is global"
    ((TESTS_RUN++))

    if [[ ! -f "$WRITE_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    "$WRITE_SCRIPT" \
        --scope global \
        --category "TDD" \
        --context "build, general" \
        --learning "Always mock external APIs in tests, never call real endpoints" \
        --project-root "$test_dir/project" \
        --global-root "$test_dir/global" \
        2>&1

    if [[ -f "$test_dir/global/LEARNINGS.md" ]]; then
        local content
        content=$(cat "$test_dir/global/LEARNINGS.md")
        if echo "$content" | grep -q "mock external APIs"; then
            pass "$test_name"
        else
            fail "$test_name" "global LEARNINGS.md has the entry" "content: '$content'"
        fi
    else
        fail "$test_name" "global LEARNINGS.md exists" "file not found"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 5: Should write to project file when scope is project
#
# @behavior Project learnings go to {project}/LEARNINGS.md
# @acceptance-criteria AC-003.1
# =============================================================================
test_project_scope() {
    local test_name="Should write to project file when scope is project"
    ((TESTS_RUN++))

    if [[ ! -f "$WRITE_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    "$WRITE_SCRIPT" \
        --scope project \
        --category "API" \
        --context "build, packages/api" \
        --learning "Rate limit middleware must come before auth middleware" \
        --project-root "$test_dir/project" \
        --global-root "$test_dir/global" \
        2>&1

    if [[ -f "$test_dir/project/LEARNINGS.md" ]] && ! [[ -f "$test_dir/global/LEARNINGS.md" ]]; then
        pass "$test_name"
    else
        local has_project has_global
        has_project=$([[ -f "$test_dir/project/LEARNINGS.md" ]] && echo "yes" || echo "no")
        has_global=$([[ -f "$test_dir/global/LEARNINGS.md" ]] && echo "yes" || echo "no")
        fail "$test_name" "project=yes, global=no" "project=$has_project, global=$has_global"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 6: Context inject should include LEARNINGS.md when files exist
#
# @behavior Session context includes learnings from both tiers
# @acceptance-criteria AC-002.5, AC-003.2
# =============================================================================
test_context_inject_loads_learnings() {
    local test_name="Context inject should include LEARNINGS.md when files exist"
    ((TESTS_RUN++))

    if [[ ! -f "$CONTEXT_SCRIPT" ]]; then
        fail "$test_name" "context-inject script exists" "not found: $CONTEXT_SCRIPT"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Create both LEARNINGS.md files
    cat > "$test_dir/project/LEARNINGS.md" << 'EOF'
# Project Learnings
## [2026-02-25] DB: Prisma migration ordering
**Learning:** Always run prisma generate before migrate
EOF

    cat > "$test_dir/global/LEARNINGS.md" << 'EOF'
# Global Learnings
## [2026-02-25] TDD: Mock external APIs
**Learning:** Never call real endpoints in tests
EOF

    local result
    result=$(cd "$test_dir/project" && \
        OSS_HOME="$test_dir/global" \
        CLAUDE_PROJECT_DIR="$test_dir/project" \
        "$CONTEXT_SCRIPT" 2>&1) || true

    # Check that learnings content appears in context output
    if echo "$result" | grep -q "prisma generate" || echo "$result" | grep -q "Learnings"; then
        pass "$test_name"
    else
        fail "$test_name" "output includes learnings content" "output: '$(echo "$result" | head -20)'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 7: Context inject should handle missing LEARNINGS.md gracefully
#
# @behavior No error when files don't exist
# @acceptance-criteria AC-003.2
# =============================================================================
test_context_inject_missing_learnings() {
    local test_name="Context inject should handle missing LEARNINGS.md gracefully"
    ((TESTS_RUN++))

    if [[ ! -f "$CONTEXT_SCRIPT" ]]; then
        fail "$test_name" "context-inject script exists" "not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)
    # No LEARNINGS.md files created

    local exit_code=0
    local result
    result=$(cd "$test_dir/project" && \
        OSS_HOME="$test_dir/global" \
        CLAUDE_PROJECT_DIR="$test_dir/project" \
        "$CONTEXT_SCRIPT" 2>&1) || exit_code=$?

    if [[ $exit_code -eq 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0" "exit $exit_code, output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 8: Learn extractor should write extracted patterns to project LEARNINGS.md
#
# @behavior Extracted error->resolution patterns are also written to LEARNINGS.md
# @acceptance-criteria AC-002.3
# =============================================================================
test_extractor_writes_to_learnings() {
    local test_name="Learn extractor should write extracted patterns to project LEARNINGS.md"
    ((TESTS_RUN++))

    local extractor_script="$SCRIPT_DIR/../learn-extractor.sh"
    if [[ ! -f "$extractor_script" ]]; then
        fail "$test_name" "learn-extractor.sh exists" "not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Create a log file with an error->resolution pattern
    mkdir -p "$test_dir/project/.oss/logs/current-session"
    cat > "$test_dir/project/.oss/logs/current-session/build.log" << 'EOF'
[2026-02-25 10:00:00] ERROR: Module not found: @prisma/client
[2026-02-25 10:00:01] Checking dependencies...
[2026-02-25 10:00:02] RESOLUTION: Run npx prisma generate to regenerate client
EOF

    local exit_code=0
    (cd "$test_dir/project" && "$extractor_script" --project-root "$test_dir/project" 2>&1) || exit_code=$?

    if [[ -f "$test_dir/project/LEARNINGS.md" ]]; then
        local content
        content=$(cat "$test_dir/project/LEARNINGS.md")
        if echo "$content" | grep -qi "prisma\|module"; then
            pass "$test_name"
        else
            fail "$test_name" "LEARNINGS.md contains extracted pattern" "content: '$content'"
        fi
    else
        fail "$test_name" "LEARNINGS.md created by extractor" "file not found (exit: $exit_code)"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 9: Learn extractor should still create skills/learned/ files
#
# @behavior Backward compat: skills/learned/ files still generated
# @acceptance-criteria AC-002.3
# =============================================================================
test_extractor_backward_compat() {
    local test_name="Learn extractor should still create skills/learned/ files"
    ((TESTS_RUN++))

    local extractor_script="$SCRIPT_DIR/../learn-extractor.sh"
    if [[ ! -f "$extractor_script" ]]; then
        fail "$test_name" "learn-extractor.sh exists" "not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Create a log file with an error->resolution pattern
    mkdir -p "$test_dir/project/.oss/logs/current-session"
    cat > "$test_dir/project/.oss/logs/current-session/build.log" << 'EOF'
[2026-02-25 10:00:00] ERROR: Module not found: @prisma/client
[2026-02-25 10:00:01] Checking dependencies...
[2026-02-25 10:00:02] RESOLUTION: Run npx prisma generate to regenerate client
EOF

    local exit_code=0
    (cd "$test_dir/project" && "$extractor_script" --project-root "$test_dir/project" 2>&1) || exit_code=$?

    # Check skills/learned/ directory has files
    local skills_count
    skills_count=$(find "$test_dir/project/.oss/skills/learned" -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')

    if [[ "$skills_count" -gt 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "skills/learned/ has .md files" "found $skills_count files (exit: $exit_code)"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running LEARNINGS.md system tests..."
echo "======================================="

test_create_learnings_file
test_correct_format
test_dedup
test_global_scope
test_project_scope
test_context_inject_loads_learnings
test_context_inject_missing_learnings
test_extractor_writes_to_learnings
test_extractor_backward_compat

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
