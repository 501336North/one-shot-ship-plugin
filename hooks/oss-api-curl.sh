#!/bin/bash
# oss-api-curl.sh - the one place hooks hand the OSS API key to curl. Source it; don't run it.
#
#   source "$SCRIPT_DIR/oss-api-curl.sh"
#   oss_api_curl "$API_KEY" -s -m 4 "https://.../api/v1/..."
#
# The Authorization header goes to curl as a config file read from stdin (`--config -`),
# so the key never appears in a process command line (any local user can read argv via ps).
# Callers therefore cannot use curl's stdin for anything else (e.g. `-d @-`).
# Returns 2 without calling curl if the key is empty or contains a line break.

oss_api_curl() {
    local key="${1:-}"
    shift
    case "$key" in '' | *$'\n'* | *$'\r'*) return 2 ;; esac
    key=${key//\\/\\\\}
    key=${key//\"/\\\"}
    # Process substitution, not a pipe: the caller's pipefail must see curl's status only,
    # and not a here-string, which bash 3.2 backs with a temp file (the key on disk).
    # -q must stay FIRST: it stops curl reading a default .curlrc ($CURL_HOME, $XDG_CONFIG_HOME, $HOME), whose
    # url=/trace-ascii= lines would send the key to a second host or write it to disk. --globoff: no {a,b}/[1-2]
    # expansion, so one call is one keyed request.
    curl -q --globoff --config - "$@" < <(printf 'header = "Authorization: Bearer %s"\n' "$key")
}

# The OSS config file, as getConfigDir in packages/cli-decrypt/src/config.ts picks it: the key and the URL
# it may go to always come from this one file.
oss_config_file() { printf '%s\n' "${OSS_CONFIG_DIR:-$HOME/.oss}/config.json"; }

# oss_api_key - prints apiKey from the OSS config when it is a non-empty string; otherwise prints nothing
# and returns 1. Without jq: the flat `"apiKey": "..."` shape that /oss:login writes.
oss_api_key() {
    local key=''
    if command -v jq &>/dev/null; then
        key=$(jq -r 'if (.apiKey | type) == "string" then .apiKey else "" end' "$(oss_config_file)" 2>/dev/null)
    else
        key=$(grep -o '"apiKey"[[:space:]]*:[[:space:]]*"[^"]*"' "$(oss_config_file)" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/')
    fi
    [[ -n "$key" ]] || return 1
    printf '%s\n' "$key"
}

# oss_api_url - prints the API base URL the key may go to (apiUrl in the OSS config, default when
# missing, null or empty; without jq always the default - a custom apiUrl needs jq). Same literal rule
# as getApiUrl in packages/cli-decrypt/src/config.ts, tested against the same case table
# (packages/cli-decrypt/test/fixtures/api-url-cases.json): a JSON string of printable ASCII matching the https or loopback-http regex below, port <= 65535. So no whitespace or
# control characters, no user@, no ? or #, no {}[] globs. Otherwise prints nothing and returns 1.
# The string-type and charset tests run inside jq, so a NUL never reaches the shell (zsh =~ stops at NUL,
# bash drops it; anchor-free, since jq's ^ and $ also match at line breaks); jq prints "!" (which the regexes refuse) for any value that fails them.
#
#   API_URL=$(oss_api_url) || { echo "apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment"; exit 1; }
oss_api_url() {
    local url='' hostport='' port=''
    local https='^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~%/-]*)?$'
    local loopback='^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?(/[A-Za-z0-9._~%/-]*)?$'
    if command -v jq &>/dev/null; then
        url=$(jq -r 'if .apiUrl == null then ""
                     elif (.apiUrl | type) != "string" then "!"
                     elif (.apiUrl | test("[^!-~]")) then "!"
                     else .apiUrl end' "$(oss_config_file)" 2>/dev/null)
    fi
    [[ -n "$url" ]] || url="https://one-shot-ship-api.onrender.com"
    [[ "$url" =~ $https || "$url" =~ $loopback ]] || return 1
    hostport=${url#*://}
    hostport=${hostport%%/*}
    case "$hostport" in
        *\]) ;;
        *:*) port=${hostport##*:}; (( 10#$port <= 65535 )) || return 1 ;;
    esac
    printf '%s\n' "$url"
}

# oss_json_field FIELD - reads JSON (a server response) on stdin and prints .FIELD as text ("" when missing,
# null or false). Control characters and the zero-width/bidi characters are removed inside jq, so those raw
# bytes never reach the shell or the terminal. Same character set as stripControl in
# packages/cli-decrypt/src/strip-control.ts.
#
#   CHAT_ID=$(printf '%s' "$RESPONSE" | oss_json_field chatId)
oss_json_field() {
    jq -r --arg f "$1" '.[$f] // "" | tostring | gsub("[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]"; "")'
}

# oss_private_dir DIR - makes DIR, a folder in the user's own ~/.oss, owner-only (700). Returns 1 when DIR is
# a symlink or not the user's (what is put in it could land anywhere, or in someone else's hands) and 2 when
# it could not be made. The one check for a private folder under ~/.oss.
oss_private_dir() {
    [[ -L "$1" ]] && return 1
    # shellcheck disable=SC2174 # only DIR itself must be private; its parent is the user's own ~/.oss
    mkdir -p -m 700 "$1" 2>/dev/null || return 2
    [[ ! -L "$1" && -O "$1" ]] || return 1
    chmod 700 "$1" 2>/dev/null || return 2
}

# oss_private_run_dir PREFIX - makes a new private folder under ~/.oss/run (both 700) for request bodies and
# API responses, and prints it. Returns 1 when ~/.oss/run is a symlink or not the user's (oss_private_dir: it
# could put them anywhere) and 2 when the folder could not be made. The caller writes into it under umask 077
# and removes it in its own EXIT trap (the decision record hook's trap also releases its lock).
#
#   tmp=$(oss_private_run_dir decision-push) || exit 0
oss_private_run_dir() {
    local run="$HOME/.oss/run"
    oss_private_dir "$run" || return
    mktemp -d "$run/$1.XXXXXX" 2>/dev/null || return 2
}

# The person's own switch for the decision push on this machine (Task 15c): decisionsPush in
# ~/.oss/settings.json. No file is on (the default); exactly one JSON object is off only when its decisionsPush
# is false (duplicate keys: the last wins). Task 16c: a file that cannot be read as exactly one object (unreadable,
# bad JSON, not an object, empty, more than one document) cannot tell, and that is off: it sets
# _OSS_SETTINGS_UNREADABLE=1 so status can say why. Task 16al: the off switch also lives in its own marker,
# ~/.oss/decisions-push-off, which only `decisions off|on` writes, so no settings.json writer can undo it: anything
# at that path (a file, a link, a folder) is off.
oss_settings_file() { printf '%s\n' "$HOME/.oss/settings.json"; }
oss_push_off_marker() { printf '%s\n' "$HOME/.oss/decisions-push-off"; }
oss_decisions_push_off() {
    local f r m
    f=$(oss_settings_file)
    m=$(oss_push_off_marker)
    _OSS_SETTINGS_UNREADABLE=""
    [[ -e "$m" || -L "$m" ]] && return 0
    [[ -e "$f" || -L "$f" ]] || return 1
    r=$(jq -s 'if length == 1 and (.[0] | type) == "object" then .[0].decisionsPush == false else "unknown" end' "$f" 2>/dev/null)
    [[ "$r" == false ]] && return 1
    [[ "$r" == true ]] || _OSS_SETTINGS_UNREADABLE=1
    return 0
}

# oss_push_off_write: Task 16al: writes the off marker, 600, through a temp file and a rename, in a ~/.oss that is
# a real folder of the person's own. Refuses (returns 1) a marker path that is a link, has another hardlink or is
# not a regular file (oss_single_link), so nothing is ever written through it.
oss_push_off_write() {
    local m d t
    m=$(oss_push_off_marker); d=${m%/*}
    [[ -d "$d" && ! -L "$d" ]] && test -O "$d" && oss_single_link "$m" || return 1
    t=$(mktemp "$d/.decisions-push-off.XXXXXX" 2>/dev/null) || return 1
    # mktemp makes the temp file 600
    if printf 'off\n' > "$t" && mv -f "$t" "$m"; then return 0; fi
    rm -f "$t"
    return 1
}

# oss_settings_mergeable FILE - 0 when a writer may merge into FILE: absent, or a regular file (not a link) of the
# person's own holding exactly one JSON object (`{}{}` is two). Task 16u: the ONE rule for every
# ~/.oss/settings.json writer (oss_settings_set, the /oss:settings save block, oss-settings-cleanup.sh; the
# watcher's save() is its TypeScript twin). `test -O`, not [[ -O ]]: the tests' other-user seam.
oss_settings_mergeable() {
    [[ -L "$1" ]] && return 1
    [[ -e "$1" ]] || return 0
    [[ -f "$1" ]] && test -O "$1" && jq -se 'length == 1 and (.[0] | type) == "object"' "$1" >/dev/null 2>&1
}

# oss_take_stale <lock> <age>: removes <lock> when it is older than <age> seconds, and returns 0 when it did.
# Task 15j: atomic, so two sessions that both saw the same stale lock never both take it (the second would
# remove the first one's fresh lock). Task 16ag: shared here by the record locks and the settings lock. The stale lock is named by its inode and time; a session first makes a
# guard folder of that name (mkdir is atomic: one session per stale lock), checks the lock is still that very
# folder, and only then removes it. A guard left by a session killed inside these few lines is removed once it
# is a minute old.
oss_lock_id() { stat -c '%i %Y' "$1" 2>/dev/null || stat -f '%i %m' "$1" 2>/dev/null; }
oss_take_stale() {
    local s g gid r=1
    s=$(oss_lock_id "$1")
    [[ "$s" =~ ^[0-9]+\ [0-9]+$ ]] && (($(date +%s) - ${s#* } > $2)) || return 1
    g="$1.stale-${s/ /-}"
    if ! mkdir "$g" 2>/dev/null; then
        gid=$(oss_lock_id "$g") && [[ "$gid" =~ ^[0-9]+\ [0-9]+$ ]] && (($(date +%s) - ${gid#* } > 60)) && rmdir "$g" 2>/dev/null
        return 1
    fi
    [[ $(oss_lock_id "$1") == "$s" ]] && rmdir "$1" 2>/dev/null && r=0
    rmdir "$g" 2>/dev/null
    return $r
}
# oss_release_lock <lock> <id>: Task 16ak: removes <lock> only while it is still the lock this writer made (<id>:
# its oss_lock_id, recorded right after the writer's own mkdir). A lock taken over meanwhile is another
# writer's and is left in place. The one release of the settings, record and push locks.
oss_release_lock() { [[ -n "$2" && $(oss_lock_id "$1") == "$2" ]] && rmdir "$1" 2>/dev/null; }
# oss_settings_locked CMD... - runs CMD holding the settings lock (Task 16ad), the one lock of every
# ~/.oss/settings.json writer (oss_settings_update here; the watcher's save() takes the same one): the folder
# ~/.oss/locks/settings, made with mkdir, in ~/.oss/locks (oss_private_dir: 700, the user's, never a link).
# A held lock is retried every 0.1 s for OSS_SETTINGS_LOCK_WAIT seconds (default 5); one older than 30 s is
# stale and taken over with oss_take_stale (never another writer's fresh lock).
# A lock path that is a link or not a folder, or a timeout, returns 1 without running CMD: a writer never
# writes unlocked. A subshell, so the lock is removed on every exit (a signal included) and the
# caller's traps are untouched.
oss_settings_locked() (
    l="$HOME/.oss/locks/settings"
    oss_private_dir "${l%/*}" || exit 1
    w=${OSS_SETTINGS_LOCK_WAIT:-5}; [[ "$w" =~ ^[0-9]+$ ]] || w=5
    n=$((w * 10))
    until mkdir "$l" 2>/dev/null; do
        [[ -L "$l" ]] || [[ -e "$l" && ! -d "$l" ]] && exit 1
        oss_take_stale "$l" 30 && continue
        ((n-- > 0)) || exit 1
        sleep 0.1
    done
    id=$(oss_lock_id "$l")
    trap 'oss_release_lock "$l" "$id"' EXIT
    trap 'exit 1' INT TERM HUP
    "$@"
)

# oss_settings_update [JQ-ARGS...] FILTER - the one write of ~/.oss/settings.json (Task 16ac): runs FILTER on the
# file (on null when there is none) and puts the result in its place through a temp file and a rename, holding
# the settings lock (oss_settings_locked) from the read to the rename. The file is always left 600, whatever
# mode it had (it holds provider apiKeys). Refuses, changing nothing, a file oss_settings_mergeable refuses or
# a lock it cannot take. The file is shared by every OSS writer: never overwrite it.
oss_settings_update() { oss_settings_locked _oss_settings_update "$@"; }
_oss_settings_update() {
    local f t
    f=$(oss_settings_file)
    oss_settings_mergeable "$f" || return 1
    mkdir -p "${f%/*}" 2>/dev/null && t=$(mktemp "${f%/*}/.settings.json.XXXXXX" 2>/dev/null) || return 1
    if { if [[ -e "$f" ]]; then jq "$@" "$f"; else jq -n "$@"; fi; } > "$t" 2>/dev/null \
        && chmod 600 "$t" 2>/dev/null && mv -f "$t" "$f" 2>/dev/null; then
        return 0
    fi
    rm -f "$t" 2>/dev/null
    return 1
}

# oss_settings_set KEY JSON-VALUE - merges one top-level setting into ~/.oss/settings.json (every other
# setting is kept), through oss_settings_update.
oss_settings_set() { oss_settings_update --arg k "$1" --argjson v "$2" '.[$k] = $v'; }
