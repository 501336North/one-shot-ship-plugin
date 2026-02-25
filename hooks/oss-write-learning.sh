#!/bin/bash
# oss-write-learning.sh - Append structured learning entries to LEARNINGS.md with dedup
#
# Usage:
#   oss-write-learning.sh --scope <project|global> --category <text> --context <text> --learning <text> \
#     [--project-root <path>] [--global-root <path>]
#
# Arguments:
#   --scope         Required. "project" or "global" - determines target file
#   --category      Required. Category of the learning (e.g., "DB", "Testing", "TDD")
#   --context       Required. Context where the learning was discovered
#   --learning      Required. The learning text itself
#   --project-root  Optional. Project root directory (defaults to git root)
#   --global-root   Optional. Global root directory (defaults to ~/.oss)
#
# Behavior:
#   - Creates LEARNINGS.md with header if it doesn't exist
#   - Deduplicates: exits 1 if the learning text already exists in the file
#   - Appends a structured entry with date, category, context, learning, scope
#   - Exits 0 on success

set -euo pipefail

# Defaults
SCOPE=""
CATEGORY=""
CONTEXT=""
LEARNING=""
PROJECT_ROOT=""
GLOBAL_ROOT=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --scope)
            SCOPE="$2"
            shift 2
            ;;
        --category)
            CATEGORY="$2"
            shift 2
            ;;
        --context)
            CONTEXT="$2"
            shift 2
            ;;
        --learning)
            LEARNING="$2"
            shift 2
            ;;
        --project-root)
            PROJECT_ROOT="$2"
            shift 2
            ;;
        --global-root)
            GLOBAL_ROOT="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: oss-write-learning.sh --scope <project|global> --category <text> --context <text> --learning <text>"
            echo ""
            echo "Options:"
            echo "  --scope         project or global (required)"
            echo "  --category      Learning category (required)"
            echo "  --context       Discovery context (required)"
            echo "  --learning      The learning text (required)"
            echo "  --project-root  Project root path (default: git root)"
            echo "  --global-root   Global root path (default: ~/.oss)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# Validate required arguments
if [[ -z "$SCOPE" ]]; then
    echo "Error: --scope is required (project|global)" >&2
    exit 1
fi

if [[ "$SCOPE" != "project" && "$SCOPE" != "global" ]]; then
    echo "Error: --scope must be 'project' or 'global'" >&2
    exit 1
fi

if [[ -z "$CATEGORY" ]]; then
    echo "Error: --category is required" >&2
    exit 1
fi

if [[ -z "$CONTEXT" ]]; then
    echo "Error: --context is required" >&2
    exit 1
fi

if [[ -z "$LEARNING" ]]; then
    echo "Error: --learning is required" >&2
    exit 1
fi

# Resolve defaults for project-root and global-root
if [[ -z "$PROJECT_ROOT" ]]; then
    PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
fi

if [[ -z "$GLOBAL_ROOT" ]]; then
    GLOBAL_ROOT="${HOME}/.oss"
fi

# Determine target file based on scope
if [[ "$SCOPE" == "project" ]]; then
    TARGET_DIR="$PROJECT_ROOT"
else
    TARGET_DIR="$GLOBAL_ROOT"
fi

TARGET_FILE="${TARGET_DIR}/LEARNINGS.md"

# Ensure target directory exists
mkdir -p "$TARGET_DIR"

# Create file with header if it doesn't exist
if [[ ! -f "$TARGET_FILE" ]]; then
    echo "# Learnings" > "$TARGET_FILE"
    echo "" >> "$TARGET_FILE"
fi

# Dedup check: search for the learning text in the existing file
if grep -qF "$LEARNING" "$TARGET_FILE" 2>/dev/null; then
    echo "Duplicate learning detected, skipping." >&2
    exit 1
fi

# Build the entry
TODAY=$(date '+%Y-%m-%d')

{
    echo "## [${TODAY}] ${CATEGORY}"
    echo "**Context:** ${CONTEXT}"
    echo "**Learning:** ${LEARNING}"
    echo "**Scope:** ${SCOPE}"
    echo ""
} >> "$TARGET_FILE"

exit 0
