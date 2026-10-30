#!/usr/bin/env bash
# oss-login.sh - /oss:login <KEY> and --key: key.txt from the value folder (the key rule) checked
# against the API the hooks use (oss_api_url), then saved to the config file they read (oss_config_file:
# $OSS_CONFIG_DIR/config.json, else ~/.oss/config.json; other settings kept; a new file gets the API URL).
# Not in the allowlist (OSS_PERMISSIONS) on purpose: changing the API key always asks the user once
# (R5-8, D12). The value folder, the key rule and the checks are oss-value.sh's, sourced here.
set -u
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/oss-value.sh" || exit 1

_ov_cmd_login() {
    local k r c u t a p
    umask 077   # the key file and anything made here: owner-only (R5-6)
    _ov_dir && _ov_get key && k=$_OV_VAL \
    || { echo "Error: the key is missing or not a valid API key. Usage: /oss:login ak_xxxxx" >&2; return 1; }
    source "$_OV_HERE/oss-api-curl.sh" || return 1   # oss_api_curl: the key on curl's stdin, never in argv
    c=$(oss_config_file)
    a=$(oss_api_url) || {
        test $? = 2 && { oss_loopback_refused >&2; return 1; }
        echo "Error: $c is not valid JSON, or its apiUrl is not an https URL (plain http only for localhost) with no user@, query or fragment; the key was not sent." >&2; return 1; }
    r=$(oss_api_curl "$k" -s -m 10 -w "\n%{http_code}" "$a/api/v1/subscription/status")
    test "$(printf '%s\n' "$r" | tail -1)" = 200 \
    || { echo "Error: Invalid API key. Get a valid key from https://www.oneshotship.com/dashboard" >&2; return 1; }
    # `--` before every path: a relative OSS_CONFIG_DIR such as "-cfg" is a path, never options (T44; chmod needs it
    # on GNU, whose getopt permutes).
    mkdir -p -- "${c%/*}"
    # The key reaches jq on stdin (--rawfile), never in argv, which ps shows to every local user (security r3 F3).
    if test -f "$c"; then u=$(printf '%s' "$k" | jq --rawfile key /dev/stdin '.apiKey = $key' -- "$c")
    else u=$(printf '%s' "$k" | jq -n --rawfile key /dev/stdin --arg url "$a" '{"apiKey": $key, "apiUrl": $url}'); fi && test -n "$u" \
    || { echo "Error: could not update $c (not valid JSON, or jq missing); it was left as it was." >&2; return 1; }
    t=$(mktemp -- "$c.XXXXXX") && printf '%s\n' "$u" > "$t" && chmod -- 600 "$t" && mv -f -- "$t" "$c" \
    && { p=$(printf '%s\n' "$r" | head -1 | oss_json_field plan 2>/dev/null); echo "Plan: ${p:-unknown}"; }   # API text: control characters removed
}

_ov_cmd_login
