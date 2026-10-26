#!/bin/bash
# oss_api_url (hooks/oss-api-curl.sh) prints the API base URL the OSS key may be sent to.
#
# @behavior Prints apiUrl from ~/.oss/config.json when it is https, or plain http to 127.0.0.1/localhost/[::1],
#           and has no ? or #. Missing/empty apiUrl (or no config): the default API. Anything else: prints
#           nothing and returns non-zero, so callers skip the request instead of sending the key.
# @business-rule The API key never travels in cleartext or to a different path than the one we build.
#           Same rule as getApiUrl in packages/cli-decrypt/src/config.ts.
#
# Usage: ./hooks/__tests__/oss-api-url.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
DEFAULT="https://one-shot-ship-api.onrender.com"

# $1 = config.json body, or the word NONE for no config file. Sets OUT and RC.
run_helper() {
    local T; T=$(mktemp -d); mkdir -p "$T/.oss"
    [[ "$1" == NONE ]] || printf '%s' "$1" > "$T/.oss/config.json"
    OUT=$(HOME="$T" "$SH" -c 'source "$1"; oss_api_url' _ "$ROOT/hooks/oss-api-curl.sh" 2>/dev/null); RC=$?
    rm -rf "$T"
}

# Ship round 1 (FR4/FR6): only a trusted OSS API is accepted, printed as its canonical origin.
for pair in "http://127.0.0.1:4100|http://127.0.0.1:4100" "http://localhost:4100|http://localhost:4100" \
            "http://localhost|http://localhost" "http://[::1]:4100/|http://[::1]:4100" \
            "https://one-shot-ship-api-staging.onrender.com|https://one-shot-ship-api-staging.onrender.com"; do
    url=${pair%%|*}; want=${pair#*|}
    run_helper "{\"apiKey\":\"k\",\"apiUrl\":\"$url\"}"
    if [[ $RC == 0 && "$OUT" == "$want" ]]; then pass "accepts '$url' as '$want'"
    else fail "accepts '$url' as '$want'" "rc=$RC out='$OUT'"; fi
done
# A well-formed custom host is not an OSS API: refused (FR4).
for url in 'https://api.example.com' 'https://api.example.com/base'; do
    run_helper "{\"apiKey\":\"k\",\"apiUrl\":\"$url\"}"
    if [[ $RC != 0 && -z "$OUT" ]]; then pass "refuses the untrusted host '$url'"
    else fail "refuses the untrusted host '$url'" "rc=$RC out='$OUT'"; fi
done

for url in 'http://evil.example.com' 'http://localhost.evil.com' 'https://api.example.com/?x=' \
           'https://api.example.com/#' 'http://127.0.0.1@evil.example.com' \
           'http://localhost:4100@evil.example.com' 'ftp://api.example.com' 'https://'; do
    run_helper "{\"apiUrl\":\"$url\"}"
    if [[ $RC != 0 && -z "$OUT" ]]; then pass "refuses '$url' (non-zero, prints nothing)"
    else fail "refuses '$url' (non-zero, prints nothing)" "rc=$RC out='$OUT'"; fi
done

for cfg in '{"apiKey":"k"}' '{"apiKey":"k","apiUrl":""}' NONE; do
    run_helper "$cfg"
    if [[ $RC == 0 && "$OUT" == "$DEFAULT" ]]; then pass "missing/empty apiUrl ($cfg) gives the default API"
    else fail "missing/empty apiUrl ($cfg) gives the default API" "rc=$RC out='$OUT'"; fi
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
