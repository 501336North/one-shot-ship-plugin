#!/bin/bash
# Remove the retired Telegram settings (plaintext bot token) from ~/.oss/settings.json.
# Run by oss-session-start.sh. Silent; any doubt or failure leaves the file as it was.
S="$HOME/.oss/settings.json"
[[ -f "$S" ]] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
# shellcheck source=hooks/oss-api-curl.sh
source "$(dirname "${BASH_SOURCE[0]}")/oss-api-curl.sh" 2>/dev/null || exit 0
oss_settings_mergeable "$S" || exit 0
jq -e 'has("telegram") or ((.notifications|type)=="object" and (.notifications|has("telegram")))' "$S" >/dev/null 2>&1 || exit 0
oss_settings_update 'del(.telegram) | if (.notifications|type)=="object" then del(.notifications.telegram) else . end'
exit 0
