#!/bin/bash
# OSS Session End Hook (PreCompact)
# Triggered on: PreCompact (before context compaction)
# Saves local context for restoration (no proprietary content)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure ~/.oss directory exists
mkdir -p ~/.oss

# Determine project .oss directory (project-local for context isolation)
# Through the guard (ADR-1): a cloned repo's committed .oss / session-context.md link is refused.
if [[ -f "$SCRIPT_DIR/oss-safe-path.sh" ]]; then source "$SCRIPT_DIR/oss-safe-path.sh"; else oss_safe_mkdir() { return 1; }; oss_safe_target() { return 1; }; oss_valid_workflow_name() { return 1; }; oss_refuse_unsafe() { echo "oss: refusing unsafe .oss path ${1:-} (oss-safe-path.sh missing)" >&2; }; fi
# SessionEnd (not PreCompact, which runs this hook too) removes this session's pointer (D2).
if declare -F oss_session_pointer_remove >/dev/null; then
    oss_hook_stdin
    if [[ "$_OSS_HOOK_EVENT" != PreCompact ]]; then
        oss_session_pointer_remove "${CLAUDE_CODE_SESSION_ID:-}"
        oss_session_pointer_remove "$_OSS_HOOK_SID"
    fi
fi
PROJECT_OSS_DIR="${CLAUDE_PROJECT_DIR:-.}/.oss"
oss_safe_mkdir "${CLAUDE_PROJECT_DIR:-.}" .oss || oss_refuse_unsafe .oss

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
if ! oss_safe_target "${CLAUDE_PROJECT_DIR:-.}" .oss/session-context.md 2>/dev/null; then
    oss_refuse_unsafe .oss/session-context.md
else
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
    # Use --project-dir so state writes go to the project-local file
    if [[ -n "${CLAUDE_PROJECT_DIR:-}" && -d "${CLAUDE_PROJECT_DIR}/.oss" ]]; then
        node "$WORKFLOW_STATE_CLI" --project-dir "$CLAUDE_PROJECT_DIR" setSupervisor idle 2>/dev/null || true
    else
        node "$WORKFLOW_STATE_CLI" setSupervisor idle 2>/dev/null || true
    fi
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
