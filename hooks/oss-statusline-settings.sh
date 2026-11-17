#!/bin/bash
# oss-statusline-settings.sh - /oss:login step 3: turns on the OSS status line in ~/.claude/settings.json (R-266).
#
# Merges {"statusLine":{"type":"command","command":"~/.oss/oss-statusline.sh","padding":0}} into the file,
# keeping every other key; creates ~/.claude and the file (mode 600) when missing. Takes no arguments and
# reads no input, so no prompt can choose what is written or where. Refuses (non-zero, nothing written) when
# settings.json or ~/.claude is a symlink, when the file is not valid JSON, or when jq is missing. The write
# is atomic (a temp file in the same folder, then mv) and keeps the file's mode. Running it twice gives the
# same bytes. mkdir, mktemp, mv, chmod, rm and stat come from fixed paths, never PATH (as oss-node.sh's).
# Round 12 (SEC LOW-A, CR M2, CR I2): PATH is fixed before jq is looked for; HOME must be the user's home in
# the password database (`id -P` on macOS, `getent passwd` elsewhere), or nothing is written; the mode is read
# with BSD or GNU stat and checked; an empty settings.json counts as {}. Lines marked `# seam:` are the ones
# hooks/__tests__/oss-statusline-settings.test.sh swaps in a copy of this file (never in this one).
set -u
PATH=/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin # seam: path
export PATH

[ $# -eq 0 ] || { echo "oss-statusline-settings: takes no arguments; nothing written" >&2; exit 2; }
case "${HOME:-}" in /*) ;; *) echo "oss-statusline-settings: HOME is not an absolute path; nothing written" >&2; exit 1 ;; esac

_sl_pick() { if [ -x "$2" ]; then printf -v "$1" '%s' "$2"; else printf -v "$1" '%s' "$3"; fi; }
_sl_pick SL_MKDIR /bin/mkdir /usr/bin/mkdir
_sl_pick SL_MKTEMP /usr/bin/mktemp /bin/mktemp
_sl_pick SL_MV /bin/mv /usr/bin/mv
_sl_pick SL_CHMOD /bin/chmod /usr/bin/chmod
_sl_pick SL_RM /bin/rm /usr/bin/rm
_sl_pick SL_STAT /usr/bin/stat /bin/stat # seam: stat

# The user's home from the password database, never from the environment.
_sl_pw_home() {
    local line fields
    if line=$(/usr/bin/id -P 2>/dev/null) && [ -n "$line" ]; then
        IFS=: read -r -a fields <<< "$line"; printf '%s' "${fields[8]:-}"; return 0
    fi
    for getent in /usr/bin/getent /bin/getent; do
        if [ -x "$getent" ] && line=$("$getent" passwd "$(/usr/bin/id -u 2>/dev/null || /bin/id -u)" 2>/dev/null) && [ -n "$line" ]; then
            IFS=: read -r -a fields <<< "$line"; printf '%s' "${fields[5]:-}"; return 0
        fi
    done
    return 1
}
PW_HOME=$(_sl_pw_home) || PW_HOME="" # seam: pw-home
[ -n "$PW_HOME" ] && [ "$HOME" = "$PW_HOME" ] || { echo "oss-statusline-settings: HOME is not your home folder in the password database; nothing written" >&2; exit 1; }

DIR="$HOME/.claude"
FILE="$DIR/settings.json"

command -v jq >/dev/null 2>&1 || { echo "oss-statusline-settings: jq is needed to update $FILE and is not installed (brew install jq); nothing written" >&2; exit 1; }
[ -L "$DIR" ] && { echo "oss-statusline-settings: $DIR is a symlink; refusing to write through it" >&2; exit 1; }
[ -L "$FILE" ] && { echo "oss-statusline-settings: $FILE is a symlink; refusing to write through it" >&2; exit 1; }
[ -e "$FILE" ] && [ ! -f "$FILE" ] && { echo "oss-statusline-settings: $FILE is not a regular file; nothing written" >&2; exit 1; }

"$SL_MKDIR" -p "$DIR" || { echo "oss-statusline-settings: could not create $DIR; nothing written" >&2; exit 1; }
[ -L "$DIR" ] && { echo "oss-statusline-settings: $DIR is a symlink; refusing to write through it" >&2; exit 1; }

MODE=600
EXISTING=0
# an empty settings.json counts as {}
[ -s "$FILE" ] && EXISTING=1
if [ "$EXISTING" = 1 ]; then
    jq -e 'type == "object"' "$FILE" >/dev/null 2>&1 \
        || { echo "oss-statusline-settings: $FILE is not valid JSON (an object); it was left as it was. Fix it and run /oss:login again" >&2; exit 1; }
fi
if [ -f "$FILE" ]; then
    # BSD stat first; GNU stat reads -f as --file-system (and fails on '%Lp'), so -c %a next
    MODE=$("$SL_STAT" -f %Lp "$FILE" 2>/dev/null) || MODE=$("$SL_STAT" -c %a "$FILE" 2>/dev/null) || MODE=600
    [[ "$MODE" =~ ^[0-7]{3,4}$ ]] || { echo "oss-statusline-settings: could not read the mode of $FILE; nothing written" >&2; exit 1; }
fi

TMPF=$("$SL_MKTEMP" "$DIR/.settings.json.XXXXXX") || { echo "oss-statusline-settings: could not create a temp file in $DIR; nothing written" >&2; exit 1; }
trap '"$SL_RM" -f "$TMPF"' EXIT

if [ "$EXISTING" = 1 ]; then
    jq '. + {"statusLine": {"type": "command", "command": "~/.oss/oss-statusline.sh", "padding": 0}}' "$FILE" > "$TMPF"
else
    jq -n '{"statusLine": {"type": "command", "command": "~/.oss/oss-statusline.sh", "padding": 0}}' > "$TMPF"
fi || { echo "oss-statusline-settings: jq failed; $FILE was left as it was" >&2; exit 1; }

"$SL_CHMOD" "$MODE" "$TMPF" && "$SL_MV" -f "$TMPF" "$FILE" \
    || { echo "oss-statusline-settings: could not replace $FILE; it was left as it was" >&2; exit 1; }
trap - EXIT
echo "Configured Claude Code status line"
