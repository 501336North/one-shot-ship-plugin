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
    curl --config - "$@" < <(printf 'header = "Authorization: Bearer %s"\n' "$key")
}
