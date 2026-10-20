#!/usr/bin/env bash
# oss-login.sh - /oss:login <KEY> and --key: key.txt from the value folder (the key rule) checked
# against the API, then saved to ~/.oss/config.json (other settings kept; a new file gets the API URL).
# Not in the allowlist (OSS_PERMISSIONS) on purpose: changing the API key always asks the user once
# (R5-8, D12). The value folder, the key rule and the checks are oss-value.sh's, sourced here.
set -u
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/oss-value.sh" || exit 1

_ov_cmd_login() {
    local k r c u t
    umask 077   # the key file and anything made here: owner-only (R5-6)
    _ov_dir && _ov_get key && k=$_OV_VAL \
    || { echo "Error: the key is missing or not a valid API key. Usage: /oss:login ak_xxxxx" >&2; return 1; }
    source "$_OV_HERE/oss-api-curl.sh" || return 1   # oss_api_curl: the key on curl's stdin, never in argv
    r=$(oss_api_curl "$k" -s -w "\n%{http_code}" "https://one-shot-ship-api.onrender.com/api/v1/subscription/status")
    test "$(printf '%s\n' "$r" | tail -1)" = 200 \
    || { echo "Error: Invalid API key. Get a valid key from https://www.oneshotship.com/dashboard" >&2; return 1; }
    c="$HOME/.oss/config.json"; mkdir -p "$HOME/.oss"
    if test -f "$c"; then u=$(jq --arg key "$k" '.apiKey = $key' "$c"); else u=$(jq -n --arg key "$k" '{"apiKey": $key, "apiUrl": "https://one-shot-ship-api.onrender.com"}'); fi && test -n "$u" \
    || { echo "Error: could not update ~/.oss/config.json (not valid JSON, or jq missing); it was left as it was." >&2; return 1; }
    t=$(mktemp "$HOME/.oss/config.json.XXXXXX") && printf '%s\n' "$u" > "$t" && chmod 600 "$t" && mv -f "$t" "$c" && echo "Plan: $(printf '%s\n' "$r" | head -1 | jq -r '.plan // "unknown"')"
}

_ov_cmd_login
