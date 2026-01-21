#!/bin/bash
# OSS Session End Hook (PreCompact)
# Triggered on: PreCompact (before context compaction)
# Saves local context for restoration (no proprietary content)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure ~/.oss directory exists
mkdir -p ~/.oss

# Determine project .oss directory (project-local for context isolation)
PROJECT_OSS_DIR="${CLAUDE_PROJECT_DIR:-.}/.oss"
mkdir -p "$PROJECT_OSS_DIR"

# --- Session Logging (for supervisor visibility) ---
LOG_SCRIPT="$SCRIPT_DIR/oss-log.sh"
if [[ -x "$LOG_SCRIPT" ]]; then
    "$LOG_SCRIPT" hook oss-session-end START
fi

# Only save context in git repositories
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    exit 0
fi

# Gather context to preserve
BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
REPO_NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" || echo "unknown")
LAST_COMMITS=$(git log -3 --oneline 2>/dev/null || echo "none")
UNCOMMITTED=$(git status -s 2>/dev/null || echo "")
# Count non-empty lines (handle empty string correctly to avoid newline issues)
if [[ -z "$UNCOMMITTED" ]]; then
    UNCOMMITTED_COUNT=0
else
    UNCOMMITTED_COUNT=$(echo "$UNCOMMITTED" | wc -l | tr -d ' ')
fi
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Save context to project-local file (not global, for multi-project isolation)
cat > "$PROJECT_OSS_DIR/session-context.md" << EOF
## Restored Session Context
_Saved: ${TIMESTAMP}_

**Repository:** $REPO_NAME
**Branch:** $BRANCH

**Recent commits:**
\`\`\`
$LAST_COMMITS
\`\`\`
EOF

# Add uncommitted changes if any
if [[ -n "$UNCOMMITTED" ]]; then
    cat >> "$PROJECT_OSS_DIR/session-context.md" << EOF

**Uncommitted changes:**
\`\`\`
$UNCOMMITTED
\`\`\`
EOF
fi

# Update workflow state for Claude Code status line
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"
NOTIFY_SCRIPT="$SCRIPT_DIR/oss-notify.sh"
WORKFLOW_STATE_CLI="$PLUGIN_ROOT/watcher/dist/cli/update-workflow-state.js"

if [[ -x "$NOTIFY_SCRIPT" ]]; then
    "$NOTIFY_SCRIPT" --session context_saved "{\"project\": \"$REPO_NAME\", \"branch\": \"$BRANCH\", \"uncommitted\": $UNCOMMITTED_COUNT}"
fi

# Update workflow state to idle (session ending)
if [[ -f "$WORKFLOW_STATE_CLI" ]]; then
    node "$WORKFLOW_STATE_CLI" setSupervisor idle 2>/dev/null || true
fi

# Log session END event
SESSION_LOG="$HOME/.oss/logs/current-session/session.log"
mkdir -p "$(dirname "$SESSION_LOG")"
TIMESTAMP=$(date '+%H:%M:%S')
echo "[$TIMESTAMP] [session] [END] project=$REPO_NAME branch=$BRANCH uncommitted=$UNCOMMITTED_COUNT" >> "$SESSION_LOG"

# Log hook COMPLETE
if [[ -x "$LOG_SCRIPT" ]]; then
    "$LOG_SCRIPT" hook oss-session-end COMPLETE
fi

# Clear current project pointer (session is ending)
# Use empty string instead of rm to avoid race conditions
echo "" > ~/.oss/current-project

exit 0
