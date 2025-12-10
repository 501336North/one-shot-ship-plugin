#!/bin/bash
# OSS Stop Hook - Plays when Claude finishes a task
# Triggered on: Stop event
#
# Respects settings from ~/.oss/settings.json (unified settings system)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS_FILE=~/.oss/settings.json

# =============================================================================
# Load settings from ~/.oss/settings.json (unified settings system)
# =============================================================================

if [[ -f "$SETTINGS_FILE" ]]; then
    if command -v jq &>/dev/null; then
        STYLE=$(jq -r '.notifications.style // "visual"' "$SETTINGS_FILE" 2>/dev/null || echo "visual")
        VOICE=$(jq -r '.notifications.voice // "Samantha"' "$SETTINGS_FILE" 2>/dev/null || echo "Samantha")
        SOUND=$(jq -r '.notifications.sound // "Glass"' "$SETTINGS_FILE" 2>/dev/null || echo "Glass")
    else
        STYLE=$(grep -o '"style"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "visual")
        VOICE=$(grep -o '"voice"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "Samantha")
        SOUND=$(grep -o '"sound"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "Glass")
    fi
else
    STYLE="visual"
    VOICE="Samantha"
    SOUND="Glass"
fi

# Exit silently if notifications disabled
[[ "$STYLE" == "none" ]] && exit 0

# =============================================================================
# Dispatch notification based on style
# =============================================================================

case "$STYLE" in
    "visual")
        # Visual notification (system notification sound plays automatically)
        OSS_ICON_PNG="$HOME/.oss/notification-icon.png"

        if command -v terminal-notifier &>/dev/null; then
            TN_ARGS=(-title "OSS" -message "Done" -sound default)
            [[ -f "$OSS_ICON_PNG" ]] && TN_ARGS+=(-appIcon "$OSS_ICON_PNG")
            terminal-notifier "${TN_ARGS[@]}" &>/dev/null || true
        else
            osascript -e 'display notification "Done" with title "OSS"' &>/dev/null || true
        fi
        ;;
    "audio")
        # Voice announcement
        if command -v say &>/dev/null; then
            say -v "$VOICE" "Done" &>/dev/null &
        fi
        ;;
    "sound")
        # Sound only (no visual, no voice)
        SOUND_FILE="/System/Library/Sounds/${SOUND}.aiff"
        if [[ -f "$SOUND_FILE" ]] && command -v afplay &>/dev/null; then
            afplay "$SOUND_FILE" &>/dev/null &
        fi
        ;;
esac

exit 0
