#!/bin/bash
# OSS Session Start Hook
# Triggered on: SessionStart
# Checks subscription and displays welcome (no proprietary content)

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
        # Visual notification
        if [[ "$(uname)" == "Darwin" ]] && command -v terminal-notifier &>/dev/null; then
            terminal-notifier -title "🚀 OSS Session Started" -subtitle "$PROJECT_NAME" \
                -message "Status: $SUBSCRIPTION_STATUS" -sound default &
        fi
        ;;
    "expired")
        echo "OSS: Subscription expired. Upgrade at https://www.oneshotship.com/pricing"
        if [[ "$(uname)" == "Darwin" ]] && command -v terminal-notifier &>/dev/null; then
            terminal-notifier -title "⚠️ OSS Subscription Expired" -subtitle "$PROJECT_NAME" \
                -message "Upgrade at oneshotship.com/pricing" -sound Basso &
        fi
        ;;
    *)
        # Don't block on network issues - just continue
        echo "OSS: Ready"
        if [[ "$(uname)" == "Darwin" ]] && command -v terminal-notifier &>/dev/null; then
            terminal-notifier -title "🚀 OSS Session Started" -subtitle "$PROJECT_NAME" \
                -message "Ready to ship!" -sound default &
        fi
        ;;
esac

# Restore previous session context if available
if [[ -f ~/.oss/session-context.md ]]; then
    echo ""
    echo "Previous session context restored."
fi

exit 0
