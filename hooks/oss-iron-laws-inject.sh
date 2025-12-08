#!/bin/bash
# ============================================================================
# OSS IRON LAWS Injection Hook
# ============================================================================
#
# STATUS: DEPRECATED - NOT IN USE
#
# This script is NO LONGER triggered by hooks.json.
# Kept for reference only.
#
# WHY DEPRECATED:
# - IRON LAWS are now injected into CLAUDE.md by /oss:login (single source of truth)
# - Per-command injection was causing context pollution
# - Claude reads CLAUDE.md at session start, making per-command injection redundant
#
# CURRENT BEHAVIOR:
# - /oss:login injects IRON LAWS into project's CLAUDE.md
# - Session start shows "IRON LAWS active" notification (oss-session-start.sh)
# - No per-command injection needed
#
# TO RE-ENABLE (not recommended):
# Add this to hooks.json under UserPromptSubmit:
#   {"type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/oss-iron-laws-inject.sh"}
#
# ============================================================================
#
# ORIGINAL PURPOSE:
# Triggered on: UserPromptSubmit (before each command)
# Fetches IRON LAWS from API and injects into context
# This ensured every command had access to the latest IRON LAWS

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"
NOTIFY_SCRIPT="$PLUGIN_ROOT/hooks/oss-notify.sh"

# Configuration
API_URL="https://one-shot-ship-api.onrender.com"
IRON_LAWS_ENDPOINT="/api/v1/prompts/shared/iron-laws"
CACHE_FILE="${HOME}/.oss/iron-laws-cache.md"
CACHE_TTL=3600  # 1 hour cache

# Debug mode - set OSS_DEBUG=1 to enable verbose notifications
DEBUG="${OSS_DEBUG:-0}"

# Always notify on first fetch per session (use session marker)
SESSION_MARKER="${HOME}/.oss/iron-laws-session-notified"

# Function to send debug notification
debug_notify() {
    local title="$1"
    local message="$2"
    local priority="${3:-low}"

    # Always show notification on fresh fetch or if DEBUG=1
    if [[ "$DEBUG" == "1" ]] || [[ ! -f "$SESSION_MARKER" ]]; then
        if [[ -x "$NOTIFY_SCRIPT" ]]; then
            "$NOTIFY_SCRIPT" "$title" "$message" "$priority" 2>/dev/null
        fi
    fi
}

# Function to check if cache is valid
cache_valid() {
    if [[ ! -f "$CACHE_FILE" ]]; then
        return 1
    fi

    local cache_age
    if [[ "$(uname)" == "Darwin" ]]; then
        cache_age=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || echo 0) ))
    else
        cache_age=$(( $(date +%s) - $(stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0) ))
    fi

    [[ $cache_age -lt $CACHE_TTL ]]
}

# Function to get API key
get_api_key() {
    if [[ -f "${HOME}/.oss/config.json" ]]; then
        if command -v jq &>/dev/null; then
            jq -r '.apiKey // empty' "${HOME}/.oss/config.json" 2>/dev/null
        else
            grep -o '"apiKey"[[:space:]]*:[[:space:]]*"[^"]*"' "${HOME}/.oss/config.json" | \
                sed 's/.*"apiKey"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
        fi
    fi
}

# Main logic
main() {
    # Check if we have a valid cache
    if cache_valid; then
        # Notify on first use per session
        if [[ ! -f "$SESSION_MARKER" ]]; then
            debug_notify "IRON LAWS" "Loaded (6 laws active)" "low"
            touch "$SESSION_MARKER"
        fi
        echo ""
        echo "<!-- IRON LAWS (cached) -->"
        cat "$CACHE_FILE"
        echo "<!-- END IRON LAWS -->"
        echo ""
        return 0
    fi

    # Get API key
    API_KEY=$(get_api_key)
    if [[ -z "$API_KEY" ]]; then
        debug_notify "IRON LAWS" "No API key - run /oss:login"
        echo ""
        echo "<!-- IRON LAWS: Not authenticated. Run /oss:login first -->"
        echo ""
        return 0
    fi

    # Fetch IRON LAWS from API
    debug_notify "IRON LAWS" "Fetching from API..."

    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $API_KEY" \
        "${API_URL}${IRON_LAWS_ENDPOINT}" 2>/dev/null)

    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [[ "$HTTP_CODE" == "200" ]] && [[ -n "$BODY" ]]; then
        # Cache the response
        mkdir -p "${HOME}/.oss"
        echo "$BODY" > "$CACHE_FILE"

        # Send notification and mark session as notified
        debug_notify "IRON LAWS" "Loaded (6 laws active)" "low"
        touch "$SESSION_MARKER"

        echo ""
        echo "<!-- IRON LAWS (fresh) -->"
        echo "$BODY"
        echo "<!-- END IRON LAWS -->"
        echo ""
    else
        # Use cached version if available, even if expired
        if [[ -f "$CACHE_FILE" ]]; then
            debug_notify "IRON LAWS" "API failed, using stale cache"
            echo ""
            echo "<!-- IRON LAWS (stale cache - API returned $HTTP_CODE) -->"
            cat "$CACHE_FILE"
            echo "<!-- END IRON LAWS -->"
            echo ""
        else
            debug_notify "IRON LAWS" "Fetch failed: $HTTP_CODE"
            echo ""
            echo "<!-- IRON LAWS: Failed to fetch (HTTP $HTTP_CODE). Check /oss:login -->"
            echo ""
        fi
    fi
}

# Run main
main
exit 0
