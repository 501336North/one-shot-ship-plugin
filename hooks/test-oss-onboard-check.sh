#!/bin/bash
# test-oss-onboard-check.sh - Unit tests for codebase onboarding detection
#
# Usage: ./test-oss-onboard-check.sh
#
# Tests the oss-onboard-check.sh script for detecting:
# - Greenfield projects (new, empty)
# - Existing codebases (has git history + files)
# - Already onboarded projects (has .oss/docs/)

set -uo pipefail
# Note: -e removed to allow tests to continue on failure

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DETECTION_SCRIPT="$SCRIPT_DIR/oss-onboard-check.sh"
TEST_DIR="/tmp/oss-onboard-test-$$"
PASSED=0
FAILED=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Setup
setup() {
  rm -rf "$TEST_DIR"
  mkdir -p "$TEST_DIR"
}

# Teardown
teardown() {
  rm -rf "$TEST_DIR"
}

# Assert function
assert_output() {
  local expected="$1"
  local actual="$2"
  local test_name="$3"

  if [[ "$actual" == "$expected" ]]; then
    echo -e "${GREEN}✓${NC} $test_name"
    ((PASSED++))
  else
    echo -e "${RED}✗${NC} $test_name"
    echo "  Expected: $expected"
    echo "  Actual:   $actual"
    ((FAILED++))
  fi
}

# Test 1: Empty directory should return "greenfield"
test_empty_dir() {
  local test_dir="$TEST_DIR/empty"
  mkdir -p "$test_dir"

  local output
  output=$("$DETECTION_SCRIPT" "$test_dir" 2>/dev/null || true)

  assert_output "greenfield" "$output" "Empty directory returns 'greenfield'"
}

# Test 2: Directory with few files (no git) should return "greenfield"
test_few_files_no_git() {
  local test_dir="$TEST_DIR/few-files"
  mkdir -p "$test_dir/src"
  touch "$test_dir/package.json"
  touch "$test_dir/src/index.ts"
  touch "$test_dir/src/app.ts"

  local output
  output=$("$DETECTION_SCRIPT" "$test_dir" 2>/dev/null || true)

  assert_output "greenfield" "$output" "Few files without git returns 'greenfield'"
}

# Test 3: Git repo with many files should return "existing"
test_git_many_files() {
  local test_dir="$TEST_DIR/existing"
  mkdir -p "$test_dir/src"
  cd "$test_dir"
  git init --quiet
  git config user.email "test@test.com"
  git config user.name "Test"

  # Create 15+ files
  touch package.json README.md
  for i in {1..15}; do
    touch "src/file$i.ts"
  done

  git add .
  git commit -m "initial" --quiet

  local output
  output=$("$DETECTION_SCRIPT" "$test_dir" 2>/dev/null || true)

  assert_output "existing" "$output" "Git repo with 15+ files returns 'existing'"
}

# Test 4: Directory with .oss/docs/ should return "onboarded"
test_already_onboarded() {
  local test_dir="$TEST_DIR/onboarded"
  mkdir -p "$test_dir/.oss/docs"
  touch "$test_dir/.oss/docs/ARCHITECTURE.md"

  local output
  output=$("$DETECTION_SCRIPT" "$test_dir" 2>/dev/null || true)

  assert_output "onboarded" "$output" "Directory with .oss/docs/ returns 'onboarded'"
}

# Test 5: Git repo with few files should return "greenfield"
test_git_few_files() {
  local test_dir="$TEST_DIR/git-few"
  mkdir -p "$test_dir"
  cd "$test_dir"
  git init --quiet
  git config user.email "test@test.com"
  git config user.name "Test"
  touch package.json README.md
  git add .
  git commit -m "initial" --quiet

  local output
  output=$("$DETECTION_SCRIPT" "$test_dir" 2>/dev/null || true)

  assert_output "greenfield" "$output" "Git repo with few files returns 'greenfield'"
}

# Test 6: Monorepo package detection
test_monorepo_package() {
  local test_dir="$TEST_DIR/monorepo/packages/api"
  mkdir -p "$test_dir/src"
  mkdir -p "$TEST_DIR/monorepo/.git"
  cd "$TEST_DIR/monorepo"
  git init --quiet
  git config user.email "test@test.com"
  git config user.name "Test"

  # Create files in package
  touch "$test_dir/package.json"
  for i in {1..12}; do
    touch "$test_dir/src/file$i.ts"
  done

  git add .
  git commit -m "initial" --quiet

  local output
  output=$("$DETECTION_SCRIPT" "$test_dir" 2>/dev/null || true)

  assert_output "existing" "$output" "Monorepo package with 12+ files returns 'existing'"
}

# Run all tests
main() {
  echo "Running oss-onboard-check.sh tests..."
  echo "======================================="

  setup

  test_empty_dir
  test_few_files_no_git
  test_git_many_files
  test_already_onboarded
  test_git_few_files
  test_monorepo_package

  teardown

  echo "======================================="
  echo "Tests: $((PASSED + FAILED)) | Passed: $PASSED | Failed: $FAILED"

  if [[ $FAILED -gt 0 ]]; then
    exit 1
  fi
}

main
