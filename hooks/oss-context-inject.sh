#!/bin/bash
# OSS Context Injection Hook
# Triggered on: UserPromptSubmit
# Injects local git context into Claude's view (no proprietary content)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_SCRIPT="$SCRIPT_DIR/oss-log.sh"

# --- Hook Logging (for supervisor visibility) ---
if [[ -x "$LOG_SCRIPT" ]]; then
    "$LOG_SCRIPT" hook oss-context-inject START
fi

# Only run in git repositories
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if [[ -x "$LOG_SCRIPT" ]]; then
        "$LOG_SCRIPT" hook oss-context-inject COMPLETE
    fi
    exit 0
fi

# Gather local context
BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
CHANGES=$(git status -s 2>/dev/null | wc -l | tr -d ' ')
STAGED=$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')
LAST_COMMIT=$(git log -1 --oneline 2>/dev/null | head -c 50 || echo "none")

# Check for uncommitted work
if [[ "$CHANGES" -gt 0 ]]; then
    CHANGE_STATUS="$CHANGES uncommitted"
else
    CHANGE_STATUS="clean"
fi

# Check for saved session context (project-local first, for multi-project isolation)
SESSION_CONTEXT=""
PROJECT_OSS_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}/.oss"
PROJECT_CONTEXT_FILE="$PROJECT_OSS_DIR/session-context.md"

if [[ -f "$PROJECT_CONTEXT_FILE" ]]; then
    SESSION_CONTEXT=$(cat "$PROJECT_CONTEXT_FILE" 2>/dev/null)
fi

# Output context (Claude Code sees this via UserPromptSubmit hook stdout)
echo "---"
echo "Branch: $BRANCH | Changes: $CHANGE_STATUS | Staged: $STAGED"
echo "Last: $LAST_COMMIT"

# Include restored session context if available
if [[ -n "$SESSION_CONTEXT" ]]; then
    echo ""
    echo "$SESSION_CONTEXT"
fi

echo "---"

# Log hook COMPLETE
if [[ -x "$LOG_SCRIPT" ]]; then
    "$LOG_SCRIPT" hook oss-context-inject COMPLETE
fi

exit 0
