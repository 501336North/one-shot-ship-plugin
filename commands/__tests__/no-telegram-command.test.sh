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

# Lines of FILE that offer Telegram (empty = none).
# ⚠ changes existing test. It replaces the check "/oss:settings never mentions Telegram", which
# also failed on the cleanup that removes the retired keys from ~/.oss/settings.json. The rule
# (@business-rule above) is "Telegram removal phase 2, Task 8: the plugin offers only the
# notification styles hooks/oss-value.sh accepts for notify_style": it is about offering, and that
# cleanup offers nothing. So a line is allowed only when, after removing the exact cleanup forms
# (a jq del() of .telegram / .notifications.telegram and nothing else, and the phrases "retired
# Telegram settings, which are removed" / "retired telegram keys are removed"), no "telegram" is
# left. Any other mention on the same line (a menu option, setup text, a style, an
# /api/v1/telegram call) still fails.
telegram_offers() {
    awk '{
        line = $0
        gsub(/del\(\.(notifications\.)?telegram(, *\.(notifications\.)?telegram)*\)/, "", line)
        gsub(/retired [Tt]elegram settings, which are removed/, "", line)
        gsub(/retired [Tt]elegram keys are removed/, "", line)
        if (tolower(line) ~ /telegram/) print NR ":" $0
    }' "$1"
}

check "there is no /oss:telegram command (commands/telegram.md)" \
    "$([[ -e "$C/telegram.md" ]] && echo "$C/telegram.md exists")"
check "/oss:settings never offers Telegram" \
    "$(telegram_offers "$C/settings.md")"
check "/oss:settings never calls /api/v1/telegram" \
    "$(grep -n '/api/v1/telegram' "$C/settings.md")"
for f in login.md webhook.md oss-audio.md; do
    check "$f does not point to /oss:telegram" "$(grep -n '/oss:telegram' "$C/$f")"
done

# The check above must still catch every way of offering Telegram: run it on temp copies of
# settings.md with one offering line added (and on cleanup-only copies, which must pass).
T="$(mktemp -d "${TMPDIR:-/tmp}/no-telegram.XXXXXX")"; trap 'rm -rf "$T"' EXIT
grep -vi 'telegram' "$C/settings.md" > "$T/clean.md"
caught() {  # $1 = description, $2 = line added to a copy of settings.md; passes when the check flags it
    { cat "$T/clean.md"; printf '%s\n' "$2"; } > "$T/f.md"
    check "the check flags $1" "$(telegram_offers "$T/f.md" | grep -qF "$2" || echo "not flagged: $2")"
}
allowed() {  # $1 = description, $2 = line added; passes when the check does not flag it
    { cat "$T/clean.md"; printf '%s\n' "$2"; } > "$T/f.md"
    check "the check allows $1" "$(telegram_offers "$T/f.md")"
}
caught "a Telegram menu option" '   - label: "Telegram", description: "Get notifications in Telegram"'
caught "Telegram setup text" 'To get notifications on your phone, connect Telegram: open the bot and send /start.'
caught "a style value of telegram" 'Pick a style: visual, audio, sound, telegram or none.'
caught "an /api/v1/telegram call" 'curl -s "$API_URL/api/v1/telegram/link" -H "Authorization: Bearer $KEY"'
caught "a line that both deletes the retired keys and offers Telegram" \
    "    '... | del(.telegram, .notifications.telegram) | .notifications.style = \"telegram\"'"
caught "a del() that also names a Telegram setting it keeps" \
    "    '... | del(.telegram, .notifications.telegram, .telegram_chat_id_keep) | .x = .telegram_token'"
allowed "the jq cleanup of the retired keys" \
    "    '.notifications = (.notifications // {}) | .version = 2 | del(.telegram, .notifications.telegram)' \\"
allowed "the comment naming the retired keys being removed" \
    '# Merge: only notifications.* change and the retired telegram keys are removed; every other key is kept'
allowed "the prose naming the retired settings being removed" \
    'merges the choices (every other setting is kept, except the retired Telegram settings, which are removed; ...)'

# Ship round 1 (pen test): the same rules hold for every command and skill file, not only settings.md, in any
# letter case, and for any file named after Telegram. Checked on a temp copy of commands/ and skills/.
P="$T/plugin"; mkdir -p "$P"; cp -R "$C" "$P/commands"; cp -R "$C/../skills" "$P/skills"
plugin_offers() {
    # NUL-separated names, and names never pasted into a sed or awk program (ship round 2): a name holding #, \ or
    # a newline must still be scanned and reported.
    local f l
    while IFS= read -r -d '' f; do
        while IFS= read -r l; do printf '%s:%s\n' "${f#"$1"/}" "$l"; done < <(telegram_offers "$f")
    done < <(find "$1/commands" "$1/skills" -name __tests__ -prune -o -type f -name '*.md' -print0)
    while IFS= read -r -d '' f; do printf '%s\n' "${f#"$1"/}"; done \
        < <(find "$1/commands" "$1/skills" -name __tests__ -prune -o -iname '*telegram*' -print0)
    grep -rniE '/oss:telegram|/api/v1/telegram' --include='*.md' --exclude-dir=__tests__ "$1/commands" "$1/skills"
}
check "no command or skill offers or calls Telegram" "$(plugin_offers "$P")"
caught_in() {  # $1 = description, $2 = file under the copy, $3 = line added; passes when flagged
    cp "$P/$2" "$T/keep" 2>/dev/null || : > "$T/keep"
    printf '%s\n' "$3" >> "$P/$2"
    local o; o="$(plugin_offers "$P")"   # captured first: under pipefail, grep -q would SIGPIPE the search
    check "the check flags $1" "$([[ -n "$o" ]] || echo "not flagged in $2")"
    if [[ -s "$T/keep" ]]; then cp "$T/keep" "$P/$2"; else rm -f "$P/$2"; fi
}
caught_in "a Telegram menu option in another command (status.md)" commands/status.md '   - label: "Telegram", description: "Get notifications in Telegram"'
caught_in "/oss:Telegram in any letter case" commands/login.md 'For phone alerts, run /oss:Telegram.'
caught_in "a command file named after Telegram (telegram-setup.md)" commands/telegram-setup.md 'Set up notifications.'
caught_in "a Telegram offer in a skill" skills/ideate.md 'Tip: connect Telegram to get notified when the design is ready.'
caught_in "a Telegram offer in a file whose name holds # (ship round 2)" 'commands/a#b.md' '   - label: "Telegram", description: "Get notifications in Telegram"'
caught_in "a Telegram offer in a file whose name holds a backslash (ship round 2)" 'commands/a\1b.md' '   - label: "Telegram", description: "Get notifications in Telegram"'
caught_in "a Telegram offer in a file whose name holds a newline (ship round 2)" $'commands/x\ny.md' '   - label: "Telegram", description: "Get notifications in Telegram"'

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
