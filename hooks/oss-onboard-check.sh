#!/bin/bash
# oss-onboard-check.sh - Detect if a codebase needs onboarding
#
# Usage: oss-onboard-check.sh [directory]
#
# Returns one of:
#   "onboarded"  - Project has .oss/docs/ (already onboarded)
#   "existing"   - Existing codebase (git + 10+ files, needs onboarding)
#   "greenfield" - New/empty project (no onboarding needed)
#
# Exit code is always 0 on success, 1 on error.

set -euo pipefail

# Directory to check (default: current directory)
TARGET_DIR="${1:-.}"

# Resolve to absolute path
TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd)" || {
  echo "error: Cannot access directory" >&2
  exit 1
}

# Check 1: Already onboarded?
if [[ -d "$TARGET_DIR/.oss/docs" ]]; then
  echo "onboarded"
  exit 0
fi

# Check 2: Is this a git repository?
# Look for .git in current dir or parent dirs
is_git_repo() {
  local dir="$1"
  while [[ "$dir" != "/" ]]; do
    if [[ -d "$dir/.git" ]]; then
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

# Check 3: Count source files (excluding hidden, node_modules, etc.)
count_source_files() {
  local dir="$1"
  find "$dir" -type f \
    \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \
    -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" \
    -o -name "*.swift" -o -name "*.kt" -o -name "*.rb" -o -name "*.php" \
    -o -name "*.c" -o -name "*.cpp" -o -name "*.h" -o -name "*.cs" \
    -o -name "*.vue" -o -name "*.svelte" \) \
    ! -path "*/node_modules/*" \
    ! -path "*/.git/*" \
    ! -path "*/dist/*" \
    ! -path "*/build/*" \
    ! -path "*/.next/*" \
    2>/dev/null | wc -l | tr -d ' '
}

# Main logic
if is_git_repo "$TARGET_DIR"; then
  FILE_COUNT=$(count_source_files "$TARGET_DIR")

  if [[ "$FILE_COUNT" -ge 10 ]]; then
    echo "existing"
    exit 0
  fi
fi

# Default: greenfield
echo "greenfield"
exit 0
