#!/bin/bash
# oss-telegram.sh - Send Telegram notifications for OSS Dev Workflow
#
# Usage:
#   oss-telegram.sh notify "Message text"
#   oss-telegram.sh notify "Message" --buttons '[{"text":"Yes","callbackData":"yes"}]'
#   oss-telegram.sh notify "Message" --buttons '[...]' --wait
#
# This is a thin wrapper around the telegram-notify.js CLI.
# It only sends notifications if Telegram is enabled in settings.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"
TELEGRAM_CLI="$PLUGIN_ROOT/watcher/dist/cli/telegram-notify.js"

# Check if CLI exists
if [[ ! -f "$TELEGRAM_CLI" ]]; then
    # CLI not built yet, silently skip
    exit 0
fi

ACTION="${1:-}"
shift || true

case "$ACTION" in
    notify)
        MESSAGE="${1:-}"
        shift || true

        if [[ -z "$MESSAGE" ]]; then
            echo "Usage: oss-telegram.sh notify \"Message\" [--buttons JSON] [--wait]" >&2
            exit 1
        fi

        # Pass remaining args to CLI
        node "$TELEGRAM_CLI" --message "$MESSAGE" "$@" 2>/dev/null || true
        ;;

    status)
        STATUS_CLI="$PLUGIN_ROOT/watcher/dist/cli/telegram-status.js"
        if [[ -f "$STATUS_CLI" ]]; then
            node "$STATUS_CLI" 2>/dev/null
        else
            echo "Telegram status CLI not built" >&2
            exit 1
        fi
        ;;

    *)
        echo "Usage: oss-telegram.sh [notify|status] ..." >&2
        exit 1
        ;;
esac

exit 0
