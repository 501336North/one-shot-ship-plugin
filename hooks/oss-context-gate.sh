#!/bin/bash
# ============================================================================
# OSS Context Gate Hook
# ============================================================================
#
# PURPOSE: Enforce fresh context for major workflow commands
#
# BEHAVIOR:
# - Checks if user is running a major command (ideate, plan, build, ship)
# - Checks transcript size (proxy for context length)
# - If context is heavy (>20 turns), BLOCKS execution
# - User must either:
#   1. Run /clear first, then re-run command (recommended)
#   2. Add --force flag to bypass (user accepts risk)
#
# WHY:
# - Fresh context = more deterministic results
# - CLAUDE.md (with IRON LAWS) is primary guidance in fresh context
# - Accumulated conversation history dilutes instructions
#
# ============================================================================

set -e

# Read input from stdin
input=$(cat)

# Parse fields
prompt=$(echo "$input" | jq -r '.prompt // ""')
transcript_path=$(echo "$input" | jq -r '.transcript_path // ""')

# Only check major workflow commands
if ! echo "$prompt" | grep -qE "^/oss:(ideate|plan|build|ship)"; then
    # Not a major command, allow through
    exit 0
fi

# Check for --force flag (user explicitly bypasses)
if echo "$prompt" | grep -qE "\-\-force"; then
    # User chose to proceed with heavy context
    echo ""
    echo "⚠️ **--force detected**: Proceeding with existing context."
    echo "For best results, consider \`/clear\` next time."
    echo ""
    exit 0
fi

# Check transcript size
if [[ -f "$transcript_path" ]]; then
    line_count=$(wc -l < "$transcript_path" | tr -d ' ')
else
    # No transcript = fresh context, allow through
    exit 0
fi

# Threshold: 20 lines in transcript = heavy context
THRESHOLD=20

if [[ $line_count -gt $THRESHOLD ]]; then
    # Heavy context detected - BLOCK and force decision
    cat << EOF
{
  "decision": "block",
  "reason": "⚠️ **Context Gate**: Heavy conversation history detected ($line_count turns).\n\nFor optimal determinism, choose one:\n\n1. **Recommended**: Run \`/clear\` first, then re-run this command\n2. **Bypass**: Re-run with \`--force\` flag (e.g., \`/oss:build --force\`)\n\nWhy? Fresh context ensures CLAUDE.md (with IRON LAWS) is the primary guidance."
}
EOF
    exit 0
fi

# Context is light, allow through
exit 0
