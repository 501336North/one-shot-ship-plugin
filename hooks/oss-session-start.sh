#!/bin/bash
# OSS Session Start Hook
# Triggered on: SessionStart
# Checks subscription, restores context, and displays welcome

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/oss-config.sh" 2>/dev/null || true

# Ensure ~/.oss directory exists
mkdir -p ~/.oss

# Auto-install terminal-notifier if missing (macOS only)
if [[ "$(uname)" == "Darwin" ]] && ! command -v terminal-notifier &>/dev/null; then
    if command -v brew &>/dev/null; then
        brew install terminal-notifier &>/dev/null &
    fi
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
        echo "OSS: Ready ($SUBSCRIPTION_STATUS)"
        ;;
    "expired")
        echo "OSS: Subscription expired. Upgrade at https://www.oneshotship.com/pricing"
        ;;
    *)
        # Don't block on network issues - just continue
        echo "OSS: Ready"
        ;;
esac

# --- Watcher Management (US-001) ---
# Spawn watcher process if not already running (singleton pattern)
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"
PROJECT_OSS_DIR="${CLAUDE_PROJECT_DIR:-.}/.oss"
WATCHER_PID_FILE="$PROJECT_OSS_DIR/watcher.pid"
WATCHER_SCRIPT="$PLUGIN_ROOT/watcher/dist/index.js"

# Ensure project .oss directory exists
mkdir -p "$PROJECT_OSS_DIR"

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

# Restore previous session context if available
if [[ -f ~/.oss/session-context.md ]]; then
    # Get context info for notification
    CONTEXT_FILE=~/.oss/session-context.md
    SAVED_LINE=$(grep "^_Saved:" "$CONTEXT_FILE" 2>/dev/null | head -1)
    BRANCH_LINE=$(grep "^\*\*Branch:\*\*" "$CONTEXT_FILE" 2>/dev/null | head -1)
    BRANCH=$(echo "$BRANCH_LINE" | sed 's/\*\*Branch:\*\* //')

    echo ""
    echo "Previous session context restored."

    # Visual notification for context restore (sync - must complete before exit)
    if [[ "$(uname)" == "Darwin" ]] && command -v terminal-notifier &>/dev/null; then
        terminal-notifier -title "🔄 Context Restored" -subtitle "$PROJECT_NAME" \
            -message "Branch: ${BRANCH:-unknown}" -sound default
    fi
else
    # No saved context - fresh start notification (sync - must complete before exit)
    if [[ "$(uname)" == "Darwin" ]] && command -v terminal-notifier &>/dev/null; then
        terminal-notifier -title "🆕 Fresh Session" -subtitle "$PROJECT_NAME" \
            -message "No previous context found" -sound default
    fi
fi

exit 0
