#!/bin/bash
#
# OSS Plugin - Context Persistence on PreCompact
#
# Saves session context before compaction for seamless continuation.
#

set -e

INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
TRIGGER=$(echo "$INPUT" | jq -r '.trigger // "auto"')
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Context storage in plugin data directory
CONTEXT_DIR="$HOME/.claude/plugins/data/oss-context"
mkdir -p "$CONTEXT_DIR"

PROJECT_HASH=$(echo "$PROJECT_DIR" | md5 | cut -c1-8)
CONTEXT_FILE="$CONTEXT_DIR/session-$PROJECT_HASH.json"

echo ""
echo "[ OSS Plugin: Saving context before compaction ]"
echo ""

# Extract context from transcript if available
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  RECENT_MESSAGES=$(tail -200 "$TRANSCRIPT_PATH" | jq -s '
    [.[] | select(.message.role == "assistant" and .message.content != null)] |
    .[-20:] |
    map({
      timestamp: .timestamp,
      content: (if .message.content | type == "array"
                then (.message.content | map(select(.type == "text")) | .[0].text // "")
                else .message.content end) | .[0:500]
    })
  ' 2>/dev/null || echo "[]")

  TOOL_USES=$(tail -500 "$TRANSCRIPT_PATH" | jq -s '
    [.[] | select(.message.content | type == "array") |
     .message.content[]? | select(.type == "tool_use")] |
    .[-30:] |
    map({name: .name, input: (.input | tostring | .[0:200])})
  ' 2>/dev/null || echo "[]")

  TODOS=$(tail -100 "$TRANSCRIPT_PATH" | jq -s '
    [.[] | select(.message.content | type == "array") |
     .message.content[]? | select(.type == "tool_use" and .name == "TodoWrite")] |
    .[-1].input.todos // []
  ' 2>/dev/null || echo "[]")
else
  RECENT_MESSAGES="[]"
  TOOL_USES="[]"
  TODOS="[]"
fi

# Git info
GIT_BRANCH=$(cd "$PROJECT_DIR" && git branch --show-current 2>/dev/null || echo "unknown")
GIT_STATUS=$(cd "$PROJECT_DIR" && git status --porcelain 2>/dev/null | head -20 | tr '\n' '|')

# Save context
cat > "$CONTEXT_FILE" << CONTEXT_JSON
{
  "saved_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "trigger": "$TRIGGER",
  "project": {
    "path": "$PROJECT_DIR",
    "name": "$(basename "$PROJECT_DIR")",
    "git_branch": "$GIT_BRANCH",
    "git_status": "$GIT_STATUS"
  },
  "session": {
    "recent_messages": $RECENT_MESSAGES,
    "recent_tool_uses": $TOOL_USES,
    "todos": $TODOS
  }
}
CONTEXT_JSON

echo "Context saved to: $CONTEXT_FILE"
echo ""

exit 0
