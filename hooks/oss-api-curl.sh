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

# oss_capped CMD... - runs CMD (curl or oss_api_curl, given --max-filesize "$OSS_BODY_MAX") and prints its output,
# read only up to OSS_BODY_MAX bytes: head -c also ends a body sent with no Content-Length, which curl before 8.4
# lets past --max-filesize. Over the cap it prints nothing and returns 63 (curl's code for --max-filesize), so the
# caller takes its failure path and never parses a cut-off body; otherwise CMD's output and status (T74b). That holds
# too when curl 8.4+ stops at the cap itself (rc 63 with the bytes read so far, or only the -w status line) (T77).
OSS_BODY_MAX=262144   # the hooks' one body cap (every API body, T81); real answers are a few KB
oss_capped() {
    local out rc=0
    out=$("$@" | head -c $((OSS_BODY_MAX + 1)); rc=${PIPESTATUS[0]}; printf x; exit "$rc") || rc=$?
    out=${out%x}
    (( rc != 63 && $(printf '%s' "$out" | wc -c) <= OSS_BODY_MAX )) || return 63
    printf '%s' "$out"
    return "$rc"
}

# oss_ask SECS RESP KEY CURL_ARGS...: one keyed API call through oss_capped, within SECS seconds (the decision hooks',
# T81). The answer goes to the file RESP and its HTTP status to $code; over the cap, whether curl or the size check
# stops the read, no answer ($code "", RESP empty), so jq never reads a cut-off body (T74c, T77).
oss_ask() {
    local secs=$1 resp=$2 key=$3 r
    shift 3
    r=$(oss_capped oss_api_curl "$key" -s --max-time "$secs" --max-filesize "$OSS_BODY_MAX" -w '\n%{http_code}' "$@")
    printf '%s' "${r%$'\n'*}" > "$resp"; code=${r##*$'\n'}
}

# The OSS config file, as getConfigDir in packages/cli-decrypt/src/config.ts picks it: the key and the URL
# it may go to always come from this one file.
oss_config_file() { printf '%s\n' "${OSS_CONFIG_DIR:-$HOME/.oss}/config.json"; }

# oss_config_strings NAMES - reads the OSS config ONCE and prints its top-level fields NAMES (comma-separated,
# e.g. apiKey,apiUrl) on one line, in that order, separated by single spaces; "" for a field that is missing or
# null. Accepts only a file that is exactly one JSON value, and that value an object, and only fields that are
# strings of printable ASCII (no space, so the split is exact; no NUL or control character reaches the shell).
# Anything else (no file, a FIFO, device or directory, which is never opened (T35), invalid JSON, several
# concatenated documents, trailing garbage, an array, a field of another type) prints nothing and returns 1, so a
# key and a URL can never come from two different documents or from a nested object (T30). jq -s (it sees every
# document in the file), else node JSON.parse (node is a plugin requirement; the path and the names go in argv
# after `--`, never into the code, and never as an option: a relative OSS_CONFIG_DIR such as "--eval=CODE" is a
# path (T39)); neither: returns 1.
#
#   CFG=$(oss_config_strings apiKey,apiUrl) || ...; KEY=${CFG%% *}; RAW_URL=${CFG#* }
oss_config_strings() {
    local f; f=$(oss_config_file)
    # Only a regular file (or a symlink to one) is opened: a FIFO would hang the read, /dev/zero never ends (T35).
    [[ -f "$f" ]] || return 1
    if command -v jq &>/dev/null; then
        jq -sr --arg n "$1" 'if length == 1 and (.[0] | type) == "object" then .[0] as $c
            | [$n | split(",")[] | $c[.] | if . == null then ""
                elif type == "string" and (test("[^!-~]") | not) then . else error("refused") end] | join(" ")
            else error("refused") end' -- "$f" 2>/dev/null
    elif command -v node &>/dev/null; then
        node -e '
            let c;
            try { c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); } catch (e) { process.exit(1); }
            if (c === null || typeof c !== "object" || Array.isArray(c)) process.exit(1);
            const out = [];
            for (const n of process.argv[2].split(",")) {
                const v = Object.prototype.hasOwnProperty.call(c, n) ? c[n] : null;
                if (v === null) out.push("");
                else if (typeof v === "string" && !/[^!-~]/.test(v)) out.push(v);
                else process.exit(1);
            }
            process.stdout.write(out.join(" ") + "\n");' -- "$f" "$1" 2>/dev/null
    else
        return 1
    fi
}

# oss_api_key - prints apiKey from the OSS config (oss_config_strings) when it is a non-empty string; otherwise
# prints nothing and returns 1.
oss_api_key() {
    local key
    key=$(oss_config_strings apiKey) || return 1
    [[ -n "$key" ]] || return 1
    printf '%s\n' "$key"
}

# oss_api_url - prints the API base URL the key may go to (apiUrl in the OSS config, default when
# missing, null or empty, or when there is no config file). A config file oss_config_strings refuses gives no
# URL: a default there would send a dev API's key to production (T21, T30).
# oss_api_url_check RAW does the rest for a caller that already read apiUrl with oss_config_strings (one read
# for the key and the URL): same output, same return codes. Same literal rule as getApiUrl in
# packages/cli-decrypt/src/config.ts, tested against the same case table
# (packages/cli-decrypt/test/fixtures/api-url-cases.json): a JSON string of printable ASCII matching the https or
# loopback-http regex below, port <= 65535. So no whitespace or control characters, no user@, no ? or #, no {}[]
# globs. Otherwise prints nothing and returns 1.
# On top of that table: a loopback-http URL that passes it is used only when OSS_ALLOW_HTTP_LOOPBACK=1 exactly
# (T20, pen-test M2: any local process can listen on a loopback port). Without it: prints nothing, returns 2,
# the one code that means "only the opt-in is missing" (oss_loopback_refused names the switch on it).
#
#   API_URL=$(oss_api_url) || { echo "apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment"; exit 1; }
oss_api_url() {
    local raw=''
    if [[ -e "$(oss_config_file)" ]]; then raw=$(oss_config_strings apiUrl) || return 1; fi
    oss_api_url_check "$raw"
}

oss_api_url_check() {
    local url="$1" hostport='' port=''
    local https='^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~%/-]*)?$'
    local loopback='^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?(/[A-Za-z0-9._~%/-]*)?$'
    [[ -n "$url" ]] || url="https://one-shot-ship-api.onrender.com"
    [[ "$url" =~ $https || "$url" =~ $loopback ]] || return 1
    hostport=${url#*://}
    hostport=${hostport%%/*}
    case "$hostport" in
        *\]) ;;
        *:*) port=${hostport##*:}; (( 10#$port <= 65535 )) || return 1 ;;
    esac
    [[ "$url" =~ $https || "${OSS_ALLOW_HTTP_LOOPBACK:-}" == 1 ]] || return 2
    printf '%s\n' "$url"
}

# oss_loopback_refused - the one line that names the opt-in when oss_api_url returns 2 (session start, login,
# oss-claude-md-template.sh).
oss_loopback_refused() { echo "OSS: apiUrl is plain http to a local API, refused; set OSS_ALLOW_HTTP_LOOPBACK=1 to allow it."; }

# oss_api_creds - the key and the URL it may go to from ONE read of the config (oss_config_strings apiKey,apiUrl),
# so a config replaced between two reads can never pair one file's key with another's URL (T37). Call it
# directly, not in $(...): it sets OSS_KEY (apiKey, "" when none), OSS_URL (as oss_api_url prints it, "" when
# refused) and OSS_URL_RC (oss_api_url's return code for the same read). Returns 0 when both are set.
oss_api_creds() {
    local cfg='' raw=''
    OSS_KEY=''; OSS_URL=''; OSS_URL_RC=0
    if [[ -e "$(oss_config_file)" ]]; then
        cfg=$(oss_config_strings apiKey,apiUrl) || { OSS_URL_RC=1; return 1; }
        OSS_KEY=${cfg%% *}; raw=${cfg#* }
    fi
    OSS_URL=$(oss_api_url_check "$raw") || OSS_URL_RC=$?
    [[ -n "$OSS_KEY" && -n "$OSS_URL" ]]
}

# oss_is_regular PATH - PATH is a regular file and not a symlink. Test it before any read of a state file in ~/.oss,
# so a FIFO there is never opened (an open would hang the hook) and a symlink is never trusted (T32).
oss_is_regular() { [[ -f "$1" && ! -L "$1" ]]; }

# oss_write_atomic PATH TEXT - writes TEXT (exactly) to PATH through a temp file in PATH's directory and `mv -f`, so
# a symlink or FIFO at PATH is replaced, never followed or opened (T32). A real directory at PATH is refused. On any
# failure the temp file is removed and it returns 1. `--` before every path: a relative "-cfg/..." is a path, never
# options (T53b).
oss_write_atomic() {
    local t
    [[ -d "$1" && ! -L "$1" ]] && return 1
    t=$(mktemp -- "$1.XXXXXX" 2>/dev/null) || return 1
    # A symlink to a directory would make mv move INTO that directory: drop the link first.
    if printf '%s' "$2" > "$t" && { [[ ! -L "$1" ]] || rm -f -- "$1"; } && mv -f -- "$t" "$1"; then return 0; fi
    rm -f -- "$t"
    return 1
}

# OSS_JQ_INVISIBLE - a jq definition, oss_invisible: the one set of characters removed from text shown to the user
# or to Claude, besides C0 (each caller adds the C0 range it strips): DEL, C1, U+2028/U+2029, every Unicode format
# character (\p{Cf}: zero-width, bidi, BOM, soft hyphen, U+061C, word joiner, tag characters), the variation selectors
# (U+FE00-FE0F, and U+E0100-E01EF inside the whole U+E0000-E0FFF block), U+034F and the blank fillers U+115F, U+1160,
# U+3164, U+FFA0, U+2800 (T52), and \p{Default_Ignorable_Code_Point}, the shared set of the API's cleanText (T52b).
# An older jq whose Oniguruma rejects that property keeps the static list (the try), never an error; that list also
# names the ignorables that are not Cf (U+17B4-17B5, U+180B-180D, U+180F, U+2065, U+FFF0-FFF8, the unassigned rest of
# U+E0000-E0FFF), so on its own it strips every default-ignorable code point (T74). Used by oss_json_field and
# oss-claude-md-template.sh (T45). _OV_JS_PRE in oss-value.sh is the node copy (T64); change them together.
# stripControl in packages/cli-decrypt/src/strip-control.ts is the TypeScript copy; it gains the T52 additions with
# the next CLI release.
OSS_JQ_INVISIBLE='def oss_invisible: "\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029\\p{Cf}\ufe00-\ufe0f\udb40\udc00-\udb43\udfff\u034f\u115f\u1160\u3164\uffa0\u2800\u17b4-\u17b5\u180b-\u180d\u180f\u2065\ufff0-\ufff8"
    + (try ("" | test("\\p{Default_Ignorable_Code_Point}") | "\\p{Default_Ignorable_Code_Point}") catch ""); '

# oss_json_field FIELD - reads JSON (a server response) on stdin and prints .FIELD of it as ONE line of text (""
# when missing, null or false, and when stdin is not exactly one JSON object: several documents never give
# several lines, T38). C0 and the oss_invisible set (OSS_JQ_INVISIBLE above: DEL, C1, U+2028/U+2029, every
# format character) are removed inside jq, so those raw bytes never reach the shell or the terminal. Only stdout
# is the contract, not the exit status: a single value that is not an object prints "" through jq's own error
# (null indexes to null; an array, string, number or boolean cannot be indexed by name), so no type check is
# needed (T46, D9).
#
#   CHAT_ID=$(printf '%s' "$RESPONSE" | oss_json_field chatId)
oss_json_field() {
    jq -rs --arg f "$1" "$OSS_JQ_INVISIBLE"'if length == 1 then .[0][$f] // "" | tostring
        | gsub("[\u0000-\u001f" + oss_invisible + "]"; "") else "" end'
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
    # T70: a link is followed (2.0.96; dotfiles managers make these), so only -f: a FIFO (it would hang the read),
    # a device, a folder or a dangling link, linked or not, cannot tell, and that is off (T67)
    [[ -f "$f" ]] || { _OSS_SETTINGS_UNREADABLE=1; return 0; }
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
# watcher's save() is its TypeScript twin), applied to the file a link leads to (oss_settings_writable, T70c).
# `test -O`, not [[ -O ]]: the tests' other-user seam.
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
# mode it had (it holds provider apiKeys). A link is followed to the file it leads to (oss_settings_target,
# T70b/T70c: dotfiles managers make these), and the new file is renamed over that one in its own folder, so the
# links stay. Refuses, changing nothing, what oss_settings_writable refuses or a lock it cannot take. The file is shared by every OSS writer: never overwrite it.
oss_settings_update() { oss_settings_locked _oss_settings_update "$@"; }
_oss_settings_update() {
    local f t
    f=$(oss_settings_target) && oss_settings_mergeable "$f" || return 1
    mkdir -p "${f%/*}" 2>/dev/null && t=$(mktemp "${f%/*}/.${f##*/}.XXXXXX" 2>/dev/null) || return 1
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

# oss_settings_target - T70b: prints the file ~/.oss/settings.json stands for: itself, or the file its links lead
# to, following at most 8 (bash 3.2 on macOS has no readlink -f; relative links resolve from their own folder).
# Nothing is opened. Returns 0 for a regular file or nothing there (not a link), 1 for a link to nothing, 2 for a
# loop or more than 8 links, 3 for anything else (a folder, a FIFO, a device, linked or not).
oss_settings_target() {
    local p l n=0
    p=$(oss_settings_file)
    while [[ -L "$p" ]]; do
        ((++n > 8)) && return 2
        l=$(readlink -- "$p") || return 1
        [[ "$l" == /* ]] || l="${p%/*}/$l"
        p=$l
    done
    if [[ ! -e "$p" ]]; then ((n == 0)) || return 1
    elif [[ ! -f "$p" ]]; then return 3
    fi
    printf '%s\n' "$p"
}

# oss_settings_writable - 0 when a writer may merge into ~/.oss/settings.json: oss_settings_mergeable on the file
# it stands for (oss_settings_target). Else oss_settings_target's code (1-3), or 4 when mergeable refuses (T70c).
oss_settings_writable() {
    local p
    p=$(oss_settings_target) || return
    oss_settings_mergeable "$p" || return 4
}

# oss_settings_why - prints why ~/.oss/settings.json cannot be written and how to fix it, when it is a link to
# nothing, a loop or no plain file (oss_settings_target 1-3); nothing otherwise (T70b, shared since T70c).
# shellcheck disable=SC2088 # the ~ is text for the person, never expanded
oss_settings_why() {
    oss_settings_target >/dev/null
    case $? in
        1) echo "~/.oss/settings.json links to a file that does not exist; create that file or remove the link, and try again" ;;
        2) echo "~/.oss/settings.json is a link loop (or more than 8 links in a row); remove the link and try again" ;;
        3) echo "~/.oss/settings.json is not a plain file, or links to something that is not one (a folder, a FIFO or a device); replace it with a plain file and try again" ;;
    esac
}
