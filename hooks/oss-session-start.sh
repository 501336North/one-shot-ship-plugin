#!/bin/bash
# OSS Session Start Hook
# Triggered on: SessionStart
# Checks subscription and displays welcome (no proprietary content)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/oss-config.sh" 2>/dev/null || true

# Ensure ~/.oss directory exists
mkdir -p ~/.oss

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

# Restore previous session context if available
if [[ -f ~/.oss/session-context.md ]]; then
    echo ""
    echo "Previous session context restored."
fi

exit 0
