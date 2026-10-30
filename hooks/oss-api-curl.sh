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
# failure the temp file is removed and it returns 1.
oss_write_atomic() {
    local t
    [[ -d "$1" && ! -L "$1" ]] && return 1
    t=$(mktemp "$1.XXXXXX" 2>/dev/null) || return 1
    # A symlink to a directory would make mv move INTO that directory: drop the link first.
    if printf '%s' "$2" > "$t" && { [[ ! -L "$1" ]] || rm -f "$1"; } && mv -f "$t" "$1"; then return 0; fi
    rm -f "$t"
    return 1
}

# OSS_JQ_INVISIBLE - a jq definition, oss_invisible: the one set of characters removed from text shown to the user
# or to Claude, besides C0 (each caller adds the C0 range it strips): DEL, C1, U+2028/U+2029 and every Unicode format
# character (\p{Cf}: zero-width, bidi, BOM, soft hyphen, U+061C, word joiner, tag characters). Used by oss_json_field
# and oss-claude-md-template.sh (T45). stripControl in packages/cli-decrypt/src/strip-control.ts is the TypeScript copy
# of the same set; change both together.
OSS_JQ_INVISIBLE='def oss_invisible: "\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029\\p{Cf}"; '

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
