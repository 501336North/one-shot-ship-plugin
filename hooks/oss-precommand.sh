#!/bin/bash
# OSS preCommand Hook - Drains task queue before user commands
#
# Implements US-008 from REQUIREMENTS.md
# Triggered on: UserPromptSubmit (before user's command runs)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"

# Check for --no-queue flag in user's command
if [[ "$*" == *"--no-queue"* ]]; then
    exit 0
fi

# Check if .oss directory exists
OSS_DIR="${CLAUDE_PROJECT_DIR:-.}/.oss"
if [[ ! -d "$OSS_DIR" ]]; then
    # No .oss directory - create it
    mkdir -p "$OSS_DIR"
fi

# Check if queue file exists
QUEUE_FILE="$OSS_DIR/queue.json"
if [[ ! -f "$QUEUE_FILE" ]]; then
    exit 0
fi

# Count pending tasks using jq or simple grep
if command -v jq &>/dev/null; then
    TASK_COUNT=$(jq '.tasks | map(select(.status == "pending")) | length' "$QUEUE_FILE" 2>/dev/null || echo "0")
else
    # Fallback: count "pending" occurrences (rough estimate)
    TASK_COUNT=$(grep -c '"status": "pending"' "$QUEUE_FILE" 2>/dev/null || echo "0")
fi

if [[ "$TASK_COUNT" == "0" ]] || [[ -z "$TASK_COUNT" ]]; then
    exit 0
fi

# Display queue summary
echo ""
echo "OSS: $TASK_COUNT queued task(s) found"

# Check if watcher/drain-queue.js exists
DRAIN_SCRIPT="$PLUGIN_ROOT/watcher/dist/drain-queue.js"
if [[ -f "$DRAIN_SCRIPT" ]]; then
    # Execute the drain script
    node "$DRAIN_SCRIPT" 2>/dev/null
else
    # Fallback: Just show the summary, don't drain
    echo "OSS: Queue drain script not found. Run 'npm run build' in watcher directory."

    # Show first pending task info
    if command -v jq &>/dev/null; then
        FIRST_TASK=$(jq -r '.tasks[] | select(.status == "pending") | "\(.priority | ascii_upcase): \(.prompt | .[0:100])"' "$QUEUE_FILE" 2>/dev/null | head -1)
        if [[ -n "$FIRST_TASK" ]]; then
            echo "OSS: Next task: $FIRST_TASK..."
        fi
    fi
fi

exit 0
