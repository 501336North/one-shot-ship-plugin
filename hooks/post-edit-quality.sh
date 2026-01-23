#!/bin/bash
# post-edit-quality.sh - Quality checks after JS/TS file edits
# Part of OSS Dev Workflow - PostToolUse hook
#
# Runs after Edit tool completes on .ts/.tsx/.js/.jsx files
# Provides: console.log detection, auto-format, type-check

set -e

# Get the file path from Claude tool input
FILE_PATH="${CLAUDE_TOOL_INPUT_FILE_PATH:-}"

# If no file path provided, try to extract from JSON input
if [[ -z "$FILE_PATH" && -n "$CLAUDE_TOOL_INPUT" ]]; then
    FILE_PATH=$(echo "$CLAUDE_TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null || echo "")
fi

# Exit silently if no file path
if [[ -z "$FILE_PATH" || ! -f "$FILE_PATH" ]]; then
    exit 0
fi

# Only process JS/TS files
if [[ ! "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
    exit 0
fi

OUTPUT=""

# === Console.log Detection ===
CONSOLE_LOGS=$(grep -n "console\.log" "$FILE_PATH" 2>/dev/null | head -5 || echo "")
if [[ -n "$CONSOLE_LOGS" ]]; then
    OUTPUT+="
⚠️  console.log detected in $FILE_PATH:
$CONSOLE_LOGS"
    if [[ $(echo "$CONSOLE_LOGS" | wc -l) -ge 5 ]]; then
        OUTPUT+="
   (showing first 5 matches)"
    fi
fi

# === Auto-Format (Prettier) ===
# Check if prettier is available and file exists
if command -v npx &> /dev/null && [[ -f "$FILE_PATH" ]]; then
    # Check if prettier is installed in the project
    if [[ -f "$(dirname "$FILE_PATH")/node_modules/.bin/prettier" ]] || \
       [[ -f "./node_modules/.bin/prettier" ]] || \
       npx prettier --version &> /dev/null 2>&1; then
        # Run prettier with timeout
        if timeout 5 npx prettier --write "$FILE_PATH" &> /dev/null 2>&1; then
            : # Silent on success
        fi
    fi
fi

# === Type Check (tsc) ===
# Only for TypeScript files
if [[ "$FILE_PATH" =~ \.(ts|tsx)$ ]]; then
    # Check if tsc is available
    if command -v npx &> /dev/null; then
        # Run tsc and filter to only errors for this file
        TSC_OUTPUT=$(npx tsc --noEmit --pretty false 2>&1 | grep -F "$(basename "$FILE_PATH")" | head -5 || echo "")
        if [[ -n "$TSC_OUTPUT" ]]; then
            OUTPUT+="

❌ TypeScript errors in $(basename "$FILE_PATH"):
$TSC_OUTPUT"
        fi
    fi
fi

# Output results if any issues found
if [[ -n "$OUTPUT" ]]; then
    echo "$OUTPUT"
fi

exit 0
