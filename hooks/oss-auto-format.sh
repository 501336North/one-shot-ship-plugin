#!/bin/bash
#
# oss-auto-format.sh
# PostToolUse hook: auto-formats code after Write/Edit operations.
#
# Environment:
#   OSS_AUTO_FORMAT=false  - disables auto-formatting
#
# Behavior:
#   - Detects project formatter via oss-detect-formatter.sh
#   - Runs the formatter (swallows errors)
#   - Always exits 0 (formatting must never block edits)

set -euo pipefail

# Check if auto-formatting is disabled
if [[ "${OSS_AUTO_FORMAT:-}" == "false" ]]; then
    exit 0
fi

# Get the file path from Claude tool input
FILE_PATH="${CLAUDE_TOOL_INPUT_FILE_PATH:-}"
if [[ -z "$FILE_PATH" && -n "${CLAUDE_TOOL_INPUT:-}" ]]; then
    FILE_PATH=$(echo "$CLAUDE_TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null || echo "")
fi

# Exit silently if no file path or file doesn't exist
if [[ -z "$FILE_PATH" || ! -f "$FILE_PATH" ]]; then
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DETECT_SCRIPT="$SCRIPT_DIR/oss-detect-formatter.sh"

# Detect the formatter
formatter=""
if [[ -f "$DETECT_SCRIPT" ]]; then
    formatter=$("$DETECT_SCRIPT" 2>/dev/null) || true
fi

# If no formatter detected, nothing to do
if [[ -z "$formatter" ]]; then
    exit 0
fi

# Run the formatter on the changed file only (not the entire project)
case "$formatter" in
    prettier)
        npx prettier --write "$FILE_PATH" 2>/dev/null || true
        ;;
    biome)
        npx biome format --write "$FILE_PATH" 2>/dev/null || true
        ;;
    gofmt)
        gofmt -w "$FILE_PATH" 2>/dev/null || true
        ;;
    black)
        black "$FILE_PATH" 2>/dev/null || true
        ;;
    rustfmt)
        rustfmt "$FILE_PATH" 2>/dev/null || true
        ;;
    *)
        # package.json format script - fall back to single file with prettier
        npx prettier --write "$FILE_PATH" 2>/dev/null || true
        ;;
esac

exit 0
