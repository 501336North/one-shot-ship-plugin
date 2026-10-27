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

# The production API: the address every call uses when the OSS config names none (also read by the status
# line to tell production from STAGING; the ratchet allows the literal only here, in the CLI and in the watcher).
OSS_API_DEFAULT_URL="https://one-shot-ship-api.onrender.com"
# The staging API (release channels). The same constant as STAGING_API_URL in packages/cli-decrypt/src/manifest-keys.ts
# and the watcher's api-credentials.ts; all three are tested against trusted-api-url-cases.json.
OSS_API_STAGING_URL="https://one-shot-ship-api-staging.onrender.com"

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

# oss_config_trusted - returns 0 when the OSS config may be read: it is missing, or a regular file (not a
# symlink) owned by this user and not world-writable. Group-writable is allowed (umask 002). The same rule as
# the CLI and the watcher (ship round 1, FR7).
oss_config_trusted() {
    local f; f=$(oss_config_file)
    [[ -e "$f" || -L "$f" ]] || return 0
    [[ ! -L "$f" && -f "$f" ]] || return 1
    [[ -n "$(find "$f" -maxdepth 0 -user "$(id -u)" ! -perm -002 2>/dev/null)" ]]
}

# oss_api_key - prints apiKey from the OSS config when it is a non-empty string; otherwise prints nothing
# and returns 1. Without jq: the flat `"apiKey": "..."` shape that /oss:login writes.
oss_api_key() {
    local key=''
    oss_config_trusted || return 1
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
oss_api_url_syntax() {
    local url='' hostport='' port=''
    local https='^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~%/-]*)?$'
    local loopback='^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?(/[A-Za-z0-9._~%/-]*)?$'
    if command -v jq &>/dev/null; then
        url=$(jq -r 'if .apiUrl == null then ""
                     elif (.apiUrl | type) != "string" then "!"
                     elif (.apiUrl | test("[^!-~]")) then "!"
                     else .apiUrl end' "$(oss_config_file)" 2>/dev/null)
    elif grep -qE '"apiUrl"[[:space:]]*:[[:space:]]*("[^"]|[^"n[:space:]])' "$(oss_config_file)" 2>/dev/null; then
        return 1   # FR5: a named apiUrl (non-empty, non-null) is never read as production just because jq is missing
    fi
    [[ -n "$url" ]] || url="$OSS_API_DEFAULT_URL"
    [[ "$url" =~ $https || "$url" =~ $loopback ]] || return 1
    hostport=${url#*://}
    hostport=${hostport%%/*}
    case "$hostport" in
        *\]) ;;
        *:*) port=${hostport##*:}; (( 10#$port <= 65535 )) || return 1 ;;
    esac
    printf '%s\n' "$url"
}

# oss_api_url - prints the canonical origin of the API the key may go to, or nothing and rc 1. The address must
# pass the syntax rule above AND be a trusted OSS API: production, staging, or loopback http (DEV). A trailing
# "/", host case and the port (numerically; dropped when it is the scheme default, as WHATWG URL does) are
# normalised; any other path, port or host is refused. The same trust
# rule as the CLI and the watcher, tested against trusted-api-url-cases.json (ship round 1, FR4/FR6). A loopback
# origin also needs a config.json and directory with no group- or world-write bit (ship round 2, SR2).
#
#   API_URL=$(oss_api_url) || { echo "apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment"; exit 1; }
oss_api_url() {
    local url scheme rest hostport path port f
    oss_config_trusted || return 1
    url=$(oss_api_url_syntax) || return 1
    scheme=${url%%://*}; rest=${url#*://}
    hostport=${rest%%/*}; path=${rest#"$hostport"}
    [[ -z "$path" || "$path" == / ]] || return 1
    hostport=$(printf '%s' "$hostport" | tr 'A-Z' 'a-z')
    # The port as WHATWG URL reads it: a number (leading zeros dropped), omitted when it is the scheme's default.
    case "$hostport" in
        *\]) ;;
        *:*) port=$(( 10#${hostport##*:} )); hostport=${hostport%:*}
             [[ "$scheme:$port" == https:443 || "$scheme:$port" == http:80 ]] || hostport="$hostport:$port" ;;
    esac
    url="$scheme://$hostport"
    case "$url" in
        "$OSS_API_DEFAULT_URL" | "$OSS_API_STAGING_URL") ;;
        http://localhost | http://localhost:[0-9]* | http://127.0.0.1 | http://127.0.0.1:[0-9]* | "http://[::1]" | "http://[::1]:"[0-9]*)
            # SR2: the key goes to whatever listens on this port, so only a config no one else can write may name it.
            f=$(oss_config_file)
            [[ -z "$(find "$f" "${f%/*}" -maxdepth 0 \( -perm -020 -o -perm -002 \) 2>/dev/null)" ]] || return 1 ;;
        *) return 1 ;;
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
