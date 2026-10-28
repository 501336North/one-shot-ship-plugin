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
# the CLI and the watcher (ship round 1, FR7). Also sets _OSS_CFG_PRIVATE to 0 when the file or its directory
# has a group- or world-write bit (SR2: such a config may not name a loopback API).
# One stat and shell tests only: the status line calls this on every render (SR9).
oss_config_trusted() {
    local f="${OSS_CONFIG_DIR:-$HOME/.oss}/config.json" m fm dm
    _OSS_CFG_PRIVATE=1
    [[ -e "$f" || -L "$f" ]] || return 0
    [[ ! -L "$f" && -f "$f" && -O "$f" ]] || return 1
    # The permission bits of the file and its directory, in octal, one per line: BSD stat, else GNU/busybox stat
    # (which reads -f as --file-system and prints file-system details, so anything but octal lines means "not BSD").
    m=$(stat -L -f %Lp "$f" "${f%/*}" 2>/dev/null) && [[ "$m" != *[!0-7$'\n']* ]] \
        || m=$(stat -L -c %a "$f" "${f%/*}" 2>/dev/null) || return 1
    fm=${m%%$'\n'*}; dm=${m#*$'\n'}
    case "$fm:$dm" in :* | *: | *[!0-7:]*) return 1 ;; esac
    (( (8#$fm & 2) == 0 )) || return 1
    (( ((8#$fm | 8#$dm) & 18) == 0 )) || _OSS_CFG_PRIVATE=0   # 18 = 0o022
}

# _oss_config_read - the trust check, then the ONE read of the OSS config (SR3): sets _OSS_CFG to its text ('' when
# missing). The URL and the key are taken from this copy, never by reading the path again after the check.
# rc 1 when the config may not be read, or holds a NUL byte (not JSON; `read -d ''` stops there and returns 0).
_oss_config_read() {
    local f="${OSS_CONFIG_DIR:-$HOME/.oss}/config.json"
    _OSS_CFG=''
    oss_config_trusted || return 1
    [[ -e "$f" ]] || return 0
    ! IFS= read -r -d '' _OSS_CFG < "$f"
}

# oss_api_key - prints apiKey from the OSS config when it is a non-empty string; otherwise prints nothing
# and returns 1. Without jq: the flat `"apiKey": "..."` shape that /oss:login writes, and only that (TR6): a config
# naming "apiKey" twice (a nested one too) or a value with a backslash (an escape) is refused, not guessed at.
oss_api_key() { _oss_config_read && _oss_cfg_key; }

# _oss_cfg_key - oss_api_key over the copy _oss_config_read made (TR5: callers that also need the URL read once).
_oss_cfg_key() {
    local key='' re='"apiKey"[[:space:]]*:[[:space:]]*"([^"]*)"' twice='"apiKey".*"apiKey"'
    if command -v jq &>/dev/null; then
        key=$(printf '%s' "$_OSS_CFG" | jq -r 'if (.apiKey | type) == "string" then .apiKey else "" end' 2>/dev/null)
    elif [[ "$_OSS_CFG" =~ $re ]]; then
        key=${BASH_REMATCH[1]-${match[1]-}}   # bash, zsh
        [[ "$key" == *\\* || "$_OSS_CFG" =~ $twice ]] && return 1
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
    _oss_config_read && _oss_url_syntax && printf '%s\n' "$_OSS_URL"
}

# _oss_url_syntax - the rule above over the copy _oss_config_read made; sets _OSS_URL.
_oss_url_syntax() {
    local url='' hostport='' port='' named='"apiUrl"[[:space:]]*:[[:space:]]*("[^"]|[^"n[:space:]])'
    local https='^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~%/-]*)?$'
    local loopback='^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?(/[A-Za-z0-9._~%/-]*)?$'
    if command -v jq &>/dev/null; then
        url=$(printf '%s' "$_OSS_CFG" | jq -r 'if .apiUrl == null then ""
                     elif (.apiUrl | type) != "string" then "!"
                     elif (.apiUrl | test("[^!-~]")) then "!"
                     else .apiUrl end' 2>/dev/null)
    elif [[ "$_OSS_CFG" =~ $named ]]; then
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
    _OSS_URL=$url
}

# oss_api_url - prints the canonical origin of the API the key may go to, or nothing and rc 1. The address must
# pass the syntax rule above AND be a trusted OSS API: production, staging, or loopback http (DEV). A trailing
# "/", host case and the port (numerically; dropped when it is the scheme default, as WHATWG URL does) are
# normalised; any other path, port or host is refused. The same trust
# rule as the CLI and the watcher, tested against trusted-api-url-cases.json (ship round 1, FR4/FR6). A loopback
# origin also needs a config.json and directory with no group- or world-write bit (ship round 2, SR2).
#
#   API_URL=$(oss_api_url) || { echo "apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment"; exit 1; }
oss_api_url() { _oss_config_read && _oss_cfg_origin; }

# _oss_cfg_origin - oss_api_url over the copy _oss_config_read made.
_oss_cfg_origin() {
    local url scheme rest hostport path port
    _oss_url_syntax || return 1
    url=$_OSS_URL
    scheme=${url%%://*}; rest=${url#*://}
    hostport=${rest%%/*}; path=${rest#"$hostport"}
    [[ -z "$path" || "$path" == / ]] || return 1
    [[ "$hostport" == *[[:upper:]]* ]] && hostport=$(printf '%s' "$hostport" | tr 'A-Z' 'a-z')   # tr only when needed (SR9)
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
            (( _OSS_CFG_PRIVATE )) || return 1 ;;
        *) return 1 ;;
    esac
    printf '%s\n' "$url"
}

# The line written above the team/personal IRON LAWS, which the signed prompt manifest does not cover (SR16).
OSS_CUSTOM_LAWS_NOTE='> Team/personal laws below are not covered by the signed prompt manifest (unverified).'
# The line written below them (TR2): team text after it cannot pass for verified text.
OSS_CUSTOM_LAWS_END='> End of unverified team/personal laws.'
# The most the section may be, in bytes, as fetched and after stripping (TR3; the honest API sends about 3 KB).
OSS_CUSTOM_LAWS_MAX_BYTES=16384
# How long the section's fetch may take, in seconds (TR4: it runs in a foreground sync at session start).
OSS_CUSTOM_LAWS_MAX_TIME=5

# The jq filter oss_custom_iron_laws runs on the section: the stripControl character set is removed (line breaks and
# tabs kept), THEN (TR2), on every line but the first, the API's heading: a Markdown heading at any indentation loses
# its #s (the API's "### <law name>" lines stay), a setext underline or thematic break is emptied, and a line that
# reads like OSS_CUSTOM_LAWS_NOTE or OSS_CUSTOM_LAWS_END is emptied. Stripping first means a zero-width character
# cannot hide a heading from the API's filter and then vanish here. Over $max bytes: nothing (TR3).
_OSS_CUSTOM_LAWS_JQ='gsub("[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]"; "")
    | split("\n")
    | .[0:1] + (.[1:] | map(
        (if test("^\\s*#{1,6}(\\s|$)") and (test("^### [^#\\s]") | not) then sub("^\\s*(#+(\\s+|$))+"; "") else . end)
        | if test("^\\s*(=+\\s*|-+\\s*|([-*_]\\s*){3,})$") or test("^[\\s>*_#]*(team/personal laws|end of unverified)"; "i")
          then "" else . end))
    | join("\n")
    | if utf8bytelength > $max then "" else . end'

# oss_custom_iron_laws - prints the team/personal IRON LAWS section the API serves beside the signed laws
# (GET /api/v1/prompts/shared/iron-laws?part=custom: only the "## Custom Team Laws" / "## Custom Personal Laws"
# part, or an empty body), with the stripControl character set removed (line breaks and tabs kept). It is NOT
# verified: callers write OSS_CUSTOM_LAWS_NOTE above it and OSS_CUSTOM_LAWS_END below it. Nothing printed and
#   rc 1 (no section) when the config is untrusted (the key is never sent), jq is missing, or the body is empty or
#        over the cap;
#   rc 2 (the fetch FAILED: curl or HTTP error, a 3xx (never followed), a 2xx that is not that section (an older API
#        that ignores ?part sends the whole laws), or no answer in OSS_CUSTOM_LAWS_MAX_TIME seconds) so a caller can
#        retry sooner (TR4, UR11).
oss_custom_iron_laws() {
    local url key body rc=0
    command -v jq >/dev/null 2>&1 || return 1
    _oss_config_read && url=$(_oss_cfg_origin) && key=$(_oss_cfg_key) || return 1   # one read for both (TR5)
    body=$(oss_api_curl "$key" -sf -m "$OSS_CUSTOM_LAWS_MAX_TIME" --max-filesize "$OSS_CUSTOM_LAWS_MAX_BYTES" \
        -w '\n%{http_code}' "$url/api/v1/prompts/shared/iron-laws?part=custom") || rc=$?
    case $rc in 0) ;; 63) return 1 ;; *) return 2 ;; esac   # 63: over --max-filesize, i.e. no section
    case "${body##*$'\n'}" in 2[0-9][0-9]) ;; *) return 2 ;; esac   # UR11: a 3xx (not followed) is a failed fetch
    body=${body%$'\n'*}
    [[ -n "$body" ]] || return 1   # an empty 200: no section
    body=$(printf '%s' "$body" | jq -Rrs --argjson max "$OSS_CUSTOM_LAWS_MAX_BYTES" "$_OSS_CUSTOM_LAWS_JQ") || return 1
    [[ -n "$body" ]] || return 1   # over the cap after stripping: no section
    case "$body" in "## Custom Team Laws"* | "## Custom Personal Laws"*) ;; *) return 2 ;; esac   # UR11: not a section
    printf '%s\n' "$body"
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
