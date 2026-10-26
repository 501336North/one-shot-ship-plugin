#!/bin/bash
# Remove the retired Telegram settings (plaintext bot token) from ~/.oss/settings.json.
# Run by oss-session-start.sh. Silent; any doubt or failure leaves the file as it was.
S="$HOME/.oss/settings.json"
[[ -f "$S" && ! -L "$S" && -O "$S" ]] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
jq -e 'has("telegram") or ((.notifications|type)=="object" and (.notifications|has("telegram")))' "$S" >/dev/null 2>&1 || exit 0
MODE=$(stat -f '%Lp' "$S" 2>/dev/null || stat -c '%a' "$S" 2>/dev/null) || exit 0
TMP=$(mktemp "$HOME/.oss/.settings.json.XXXXXX" 2>/dev/null) || exit 0
if jq 'del(.telegram) | if (.notifications|type)=="object" then del(.notifications.telegram) else . end' "$S" > "$TMP" 2>/dev/null \
   && chmod "$MODE" "$TMP" 2>/dev/null && mv -f "$TMP" "$S" 2>/dev/null; then
    exit 0
fi
rm -f "$TMP" 2>/dev/null
exit 0
