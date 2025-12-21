#!/bin/bash
# OSS Session Start Hook
# Triggered on: SessionStart
# Checks subscription, restores context, and displays welcome

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/oss-config.sh" 2>/dev/null || true

# Ensure ~/.oss directory exists with secure permissions
mkdir -p ~/.oss
chmod 700 ~/.oss  # Only owner can access

# Update status line script from plugin (ensures latest version)
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$SCRIPT_DIR")}"
if [[ -f "$PLUGIN_ROOT/hooks/oss-statusline.sh" ]]; then
    cp "$PLUGIN_ROOT/hooks/oss-statusline.sh" ~/.oss/oss-statusline.sh
    chmod +x ~/.oss/oss-statusline.sh
fi

# Check for API key configuration
CONFIG_FILE=~/.oss/config.json
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "OSS: Not logged in. Run /oss login to authenticate."
    exit 0
fi

# Check if API key exists in config
API_KEY=$(grep -o '"apiKey"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" 2>/dev/null | cut -d'"' -f4)
if [[ -z "$API_KEY" ]]; then
    echo "OSS: No API key found. Run /oss login to authenticate."
    exit 0
fi

# Quick subscription check (non-blocking)
# Note: Full validation happens when skills are used
SUBSCRIPTION_STATUS=$(curl -s -m 2 -H "Authorization: Bearer $API_KEY" \
    "https://one-shot-ship-api.onrender.com/api/v1/subscription/status" 2>/dev/null | \
    grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4 || echo "unknown")

# Get project name for notification
PROJECT_NAME="${CLAUDE_PROJECT_DIR##*/}"
[[ -z "$PROJECT_NAME" ]] && PROJECT_NAME="OSS"

# Display session start message
case "$SUBSCRIPTION_STATUS" in
    "active"|"trial")
        echo "OSS: Ready ($SUBSCRIPTION_STATUS) - IRON LAWS active"
        ;;
    "expired")
        echo "OSS: Subscription expired. Upgrade at https://www.oneshotship.com/pricing"
        ;;
    *)
        # Don't block on network issues - just continue
        echo "OSS: Ready - IRON LAWS active"
        ;;
esac

# Clear iron-laws session marker (legacy cleanup)
rm -f ~/.oss/iron-laws-session-notified 2>/dev/null

# --- Watcher Management (US-001) ---
# Spawn watcher process if not already running (singleton pattern)
# PLUGIN_ROOT already set above
PROJECT_OSS_DIR="${CLAUDE_PROJECT_DIR:-.}/.oss"
WATCHER_PID_FILE="$PROJECT_OSS_DIR/watcher.pid"
WATCHER_SCRIPT="$PLUGIN_ROOT/watcher/dist/index.js"
WORKFLOW_STATE_CLI="$PLUGIN_ROOT/watcher/dist/cli/update-workflow-state.js"
HEALTH_CHECK_CLI="$PLUGIN_ROOT/watcher/dist/cli/health-check.js"

# Ensure project .oss directory exists
mkdir -p "$PROJECT_OSS_DIR"

# Write current project path for multi-project support
# Other hooks/scripts read this to know which project is active
if [[ -n "$CLAUDE_PROJECT_DIR" ]]; then
    echo "$CLAUDE_PROJECT_DIR" > ~/.oss/current-project
    chmod 600 ~/.oss/current-project  # Only owner can read/write
fi

# Initialize workflow state (for Claude Code status line)
if [[ -f "$WORKFLOW_STATE_CLI" ]]; then
    node "$WORKFLOW_STATE_CLI" init 2>/dev/null || true
    node "$WORKFLOW_STATE_CLI" setSupervisor watching 2>/dev/null || true
    # Clear any stale notification from previous session (fresh one set below)
    node "$WORKFLOW_STATE_CLI" clearNotification 2>/dev/null || true
fi

# Check if watcher is already running
if [[ -f "$WATCHER_PID_FILE" ]]; then
    WATCHER_PID=$(cat "$WATCHER_PID_FILE" 2>/dev/null)
    if [[ -n "$WATCHER_PID" ]] && ps -p "$WATCHER_PID" > /dev/null 2>&1; then
        echo "OSS: Watcher running (PID: $WATCHER_PID)"
    else
        # Stale PID file - clean up
        rm -f "$WATCHER_PID_FILE"
        if [[ -f "$WATCHER_SCRIPT" ]]; then
            # Start new watcher
            cd "$PROJECT_OSS_DIR/.." && node "$WATCHER_SCRIPT" &
            echo $! > "$WATCHER_PID_FILE"
            echo "OSS: Watcher started (PID: $!)"
        fi
    fi
else
    if [[ -f "$WATCHER_SCRIPT" ]]; then
        # Start watcher
        cd "$PROJECT_OSS_DIR/.." && node "$WATCHER_SCRIPT" &
        echo $! > "$WATCHER_PID_FILE"
        echo "OSS: Watcher started (PID: $!)"
    fi
fi

# --- Health Check (Run tests on session start) ---
# Run npm test to catch any pre-existing failures and queue them
# This ensures the supervisor catches issues BEFORE work begins
if [[ -f "$HEALTH_CHECK_CLI" ]] && [[ -f "package.json" ]]; then
    echo "OSS: Running health check (background)..."
    # Run in background to not block session start
    # Output goes to session log for debugging
    (
        cd "${CLAUDE_PROJECT_DIR:-.}"
        # Run with verbose flag, log output to session log
        # Use > to overwrite (not >>) so stale results don't persist
        LOG_DIR="$HOME/.oss/logs/current-session"
        mkdir -p "$LOG_DIR"
        node "$HEALTH_CHECK_CLI" --verbose > "$LOG_DIR/health-check.log" 2>&1
        EXIT_CODE=$?
        # Also echo summary to session
        if [[ $EXIT_CODE -eq 0 ]]; then
            echo "OSS: ✅ Health check passed - all tests passing"
        elif [[ $EXIT_CODE -eq 1 ]]; then
            echo "OSS: ❌ Health check found failing tests - check queue"
        else
            echo "OSS: ⚠️ Health check error - see ~/.oss/logs/current-session/health-check.log"
        fi
    ) &
fi

# Restore previous session context if available
NOTIFY_SCRIPT="$PLUGIN_ROOT/hooks/oss-notify.sh"

if [[ -f ~/.oss/session-context.md ]]; then
    # Get context info for notification
    CONTEXT_FILE=~/.oss/session-context.md
    BRANCH_LINE=$(grep "^\*\*Branch:\*\*" "$CONTEXT_FILE" 2>/dev/null | head -1)
    BRANCH=$(echo "$BRANCH_LINE" | sed 's/\*\*Branch:\*\* //')

    # Parse save date from context file (format: _Saved: 2025-12-09 11:54:10_)
    SAVE_DATE_RAW=$(grep "^_Saved:" "$CONTEXT_FILE" 2>/dev/null | sed 's/_Saved: //' | sed 's/_$//')

    # Calculate human-friendly "X ago" format
    SAVE_DATE="unknown"
    if [[ -n "$SAVE_DATE_RAW" ]]; then
        # Convert save date to epoch (macOS vs Linux)
        if [[ "$(uname)" == "Darwin" ]]; then
            SAVE_EPOCH=$(date -j -f "%Y-%m-%d %H:%M:%S" "$SAVE_DATE_RAW" "+%s" 2>/dev/null || echo "0")
        else
            SAVE_EPOCH=$(date -d "$SAVE_DATE_RAW" "+%s" 2>/dev/null || echo "0")
        fi
        NOW_EPOCH=$(date "+%s")

        if [[ "$SAVE_EPOCH" != "0" ]]; then
            DIFF_SECS=$((NOW_EPOCH - SAVE_EPOCH))
            if [[ $DIFF_SECS -lt 60 ]]; then
                SAVE_DATE="just now"
            elif [[ $DIFF_SECS -lt 3600 ]]; then
                MINS=$((DIFF_SECS / 60))
                SAVE_DATE="${MINS}m ago"
            elif [[ $DIFF_SECS -lt 86400 ]]; then
                HOURS=$((DIFF_SECS / 3600))
                SAVE_DATE="${HOURS}h ago"
            else
                DAYS=$((DIFF_SECS / 86400))
                SAVE_DATE="${DAYS}d ago"
            fi
        fi
    fi

    # Count uncommitted changes from current git status
    UNCOMMITTED_COUNT=$(git status -s 2>/dev/null | grep -c . || echo "0")

    echo ""
    echo "Previous session context restored."

    # Visual notification for context restore (via unified oss-notify.sh)
    if [[ -x "$NOTIFY_SCRIPT" ]]; then
        "$NOTIFY_SCRIPT" --session context_restored "{\"project\": \"$PROJECT_NAME\", \"branch\": \"${BRANCH:-unknown}\", \"saveDate\": \"${SAVE_DATE}\", \"uncommitted\": $UNCOMMITTED_COUNT}"
    fi
else
    # No saved context - fresh start notification (via unified oss-notify.sh)
    if [[ -x "$NOTIFY_SCRIPT" ]]; then
        "$NOTIFY_SCRIPT" --session fresh_start "{\"project\": \"$PROJECT_NAME\"}"
    fi
fi

exit 0
