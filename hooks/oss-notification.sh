#!/bin/bash
# OSS Notification Hook - Plays when Claude needs user input
# Triggered on: Notification event
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
        # Visual notification - update status line with non-sticky notification
        # The status line is the primary visual feedback mechanism
        PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"
        WORKFLOW_STATE_CLI="$PLUGIN_ROOT/watcher/dist/cli/update-workflow-state.js"
        if [[ -f "$WORKFLOW_STATE_CLI" ]]; then
            node "$WORKFLOW_STATE_CLI" setNotification "Ready" 10 2>/dev/null || true
        fi

        # ALSO show terminal-notifier popup so user knows Claude needs input
        # Uses "Funk" sound for OSS brand recognition (Ready = funky groove)
        if command -v terminal-notifier &>/dev/null; then
            terminal-notifier -title "OSS" -message "Ready" -sound "Funk" &>/dev/null &
        fi
        ;;
    "audio")
        # Voice announcement
        if command -v say &>/dev/null; then
            say -v "$VOICE" "Ready" &>/dev/null &
        fi
        ;;
    "sound")
        # Sound only (no visual, no voice)
        SOUND_FILE="/System/Library/Sounds/${SOUND}.aiff"
        if [[ -f "$SOUND_FILE" ]] && command -v afplay &>/dev/null; then
            afplay "$SOUND_FILE" &>/dev/null &
        fi
        ;;
    "telegram")
        # Telegram style: Use local notifications only for "Ready" events
        # AskUserQuestion prompts go to Telegram via PreToolUse hook (oss-ask-telegram.sh)
        # "Ready" notifications stay local - sending them to Telegram would spam the user
        PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"
        WORKFLOW_STATE_CLI="$PLUGIN_ROOT/watcher/dist/cli/update-workflow-state.js"
        if [[ -f "$WORKFLOW_STATE_CLI" ]]; then
            node "$WORKFLOW_STATE_CLI" setNotification "Ready" 10 2>/dev/null || true
        fi
        # Local popup notification (not sent to Telegram)
        if command -v terminal-notifier &>/dev/null; then
            terminal-notifier -title "OSS" -message "Ready" -sound "Funk" &>/dev/null &
        fi
        ;;
esac

exit 0
