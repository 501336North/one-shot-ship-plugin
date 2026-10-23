#!/bin/bash
# No plugin command offers or calls Telegram.
#
# @behavior A user browsing /oss:* commands is never offered Telegram: there is no /oss:telegram, the
#           /oss:settings wizard offers visual, audio, sound or none, and no command calls the
#           /api/v1/telegram endpoints (the customer Telegram bot was removed from the API).
# @business-rule Telegram removal phase 2, Task 8: the plugin offers only the notification styles
#           hooks/oss-value.sh accepts for notify_style.
set -uo pipefail
C="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN=0; FAILED=0
check() {  # $1 = description, $2 = offending lines (empty = pass)
    RUN=$((RUN + 1))
    if [[ -z "$2" ]]; then echo "✓ PASS: $1"
    else echo "✗ FAIL: $1"; printf '    %s\n' "$2"; FAILED=$((FAILED + 1)); fi
}

check "there is no /oss:telegram command (commands/telegram.md)" \
    "$([[ -e "$C/telegram.md" ]] && echo "$C/telegram.md exists")"
check "/oss:settings never mentions Telegram" \
    "$(grep -ni 'telegram' "$C/settings.md")"
check "/oss:settings never calls /api/v1/telegram" \
    "$(grep -n '/api/v1/telegram' "$C/settings.md")"
for f in login.md webhook.md oss-audio.md; do
    check "$f does not point to /oss:telegram" "$(grep -n '/oss:telegram' "$C/$f")"
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
