#!/bin/bash
# oss-notify.sh - Unified notification hook for OSS Dev Workflow
#
# Usage: oss-notify.sh "Title" "Message" [priority]
#
# Priority levels:
#   low      - Command start, agent spawn
#   high     - Command complete, PR created (default)
#   critical - Command failed, loop detected
#
# Respects settings from ~/.oss/settings.json

set -euo pipefail

TITLE="${1:-Notification}"
MESSAGE="${2:-}"
PRIORITY="${3:-high}"

# Load settings
SETTINGS_FILE=~/.oss/settings.json

if [[ -f "$SETTINGS_FILE" ]]; then
    # Use jq if available, otherwise fall back to defaults
    if command -v jq &>/dev/null; then
        STYLE=$(jq -r '.notifications.style // "visual"' "$SETTINGS_FILE" 2>/dev/null || echo "visual")
        VERBOSITY=$(jq -r '.notifications.verbosity // "important"' "$SETTINGS_FILE" 2>/dev/null || echo "important")
        VOICE=$(jq -r '.notifications.voice // "Samantha"' "$SETTINGS_FILE" 2>/dev/null || echo "Samantha")
        SOUND=$(jq -r '.notifications.sound // "Glass"' "$SETTINGS_FILE" 2>/dev/null || echo "Glass")
    else
        # Fallback: try grep/sed parsing
        STYLE=$(grep -o '"style"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "visual")
        VERBOSITY=$(grep -o '"verbosity"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "important")
        VOICE=$(grep -o '"voice"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "Samantha")
        SOUND=$(grep -o '"sound"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "Glass")
    fi
else
    # Default settings
    STYLE="visual"
    VERBOSITY="important"
    VOICE="Samantha"
    SOUND="Glass"
fi

# Filter by verbosity
case "$VERBOSITY" in
    "errors-only")
        [[ "$PRIORITY" != "critical" ]] && exit 0
        ;;
    "important")
        [[ "$PRIORITY" == "low" ]] && exit 0
        ;;
    # "all" - allow everything through
esac

# Skip if style is none
[[ "$STYLE" == "none" ]] && exit 0

# Strip emojis for terminal-notifier (they render poorly)
CLEAN_TITLE=$(echo "$TITLE" | sed 's/[🎯✅❌🤖📝🎉⚠️📋🔨🚢]//g' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

# Dispatch notification based on style
case "$STYLE" in
    "visual")
        if command -v terminal-notifier &>/dev/null; then
            terminal-notifier -title "$CLEAN_TITLE" -message "$MESSAGE" -sound default &>/dev/null || true
        else
            # Fallback: use osascript
            osascript -e "display notification \"$MESSAGE\" with title \"$CLEAN_TITLE\"" &>/dev/null || true
        fi
        ;;
    "audio")
        if command -v say &>/dev/null; then
            say -v "$VOICE" "$MESSAGE" &>/dev/null || true
        fi
        ;;
    "sound")
        SOUND_FILE="/System/Library/Sounds/${SOUND}.aiff"
        if [[ -f "$SOUND_FILE" ]] && command -v afplay &>/dev/null; then
            afplay "$SOUND_FILE" &>/dev/null || true
        fi
        ;;
esac

exit 0
