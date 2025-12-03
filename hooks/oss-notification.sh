#!/bin/bash
# OSS Notification Hook - Plays when Claude needs user input
# Triggered on: Notification event

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/oss-config.sh"

# Exit silently if audio disabled
[[ "$OSS_AUDIO_ENABLED" != "true" ]] && exit 0

if [[ "$OSS_USE_VOICE" == "true" ]]; then
    # Use voice
    say -v "$OSS_VOICE" "$OSS_PHRASE_READY" 2>/dev/null &
else
    # Use system sound
    afplay "/System/Library/Sounds/${OSS_SOUND_READY}.aiff" 2>/dev/null &
fi

exit 0
