#!/bin/bash
# OSS Session End Hook (PreCompact)
# Triggered on: PreCompact (before context compaction)
# Saves local context for restoration (no proprietary content)

# Ensure ~/.oss directory exists
mkdir -p ~/.oss

# Only save context in git repositories
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    exit 0
fi

# Gather context to preserve
BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
REPO_NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" || echo "unknown")
LAST_COMMITS=$(git log -3 --oneline 2>/dev/null || echo "none")
UNCOMMITTED=$(git status -s 2>/dev/null || echo "")
UNCOMMITTED_COUNT=$(echo "$UNCOMMITTED" | grep -c . || echo "0")
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Save context to file
cat > ~/.oss/session-context.md << EOF
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
    cat >> ~/.oss/session-context.md << EOF

**Uncommitted changes:**
\`\`\`
$UNCOMMITTED
\`\`\`
EOF
fi

# Visual notification via unified oss-notify.sh (supports Jamf Notifier + terminal-notifier)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

exit 0
