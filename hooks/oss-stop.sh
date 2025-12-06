#!/bin/bash
# OSS Stop Hook - Plays when Claude finishes a task
# Triggered on: Stop event

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/oss-config.sh"

# Get project name for notification
PROJECT_NAME="${CLAUDE_PROJECT_DIR##*/}"
[[ -z "$PROJECT_NAME" ]] && PROJECT_NAME="OSS"

# Visual notification (macOS)
if [[ "$(uname)" == "Darwin" ]] && command -v terminal-notifier &>/dev/null; then
    terminal-notifier -title "✅ OSS Task Complete" -subtitle "$PROJECT_NAME" \
        -message "Claude has finished" -sound default &
fi

# Exit silently if audio disabled
[[ "$OSS_AUDIO_ENABLED" != "true" ]] && exit 0

if [[ "$OSS_USE_VOICE" == "true" ]]; then
    # Use voice
    say -v "$OSS_VOICE" "$OSS_PHRASE_DONE" 2>/dev/null &
else
    # Use system sound
    afplay "/System/Library/Sounds/${OSS_SOUND_DONE}.aiff" 2>/dev/null &
fi

exit 0
