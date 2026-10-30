#!/bin/bash
# oss_api_url (hooks/oss-api-curl.sh) prints the API base URL the OSS key may be sent to.
#
# @behavior Prints apiUrl from ~/.oss/config.json when it is https, or plain http to 127.0.0.1/localhost/[::1]
#           when OSS_ALLOW_HTTP_LOOPBACK=1 exactly, and has no ? or #. Loopback http without that opt-in:
#           prints nothing and returns 2, the one code session start reads to name the switch (T20). Missing/empty apiUrl (or no config): the default API. Anything else: prints
#           nothing and returns non-zero, so callers skip the request instead of sending the key.
# @business-rule The API key never travels in cleartext or to a different path than the one we build.
#           Same rule as getApiUrl in packages/cli-decrypt/src/config.ts.
#
# Usage: ./hooks/__tests__/oss-api-url.test.sh
set -uo pipefail
# The hooks read the API key and URL from $OSS_CONFIG_DIR/config.json: a developer's exported
# override must not lead them to the real key and the real API (T19).
unset OSS_CONFIG_DIR OSS_MANIFEST_URL
# Plain http to a loopback API is allowed only with this opt-in: each case sets it (ALLOW) or not (T20).
unset OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
DEFAULT="https://one-shot-ship-api.onrender.com"

# OSS_ALLOW_HTTP_LOOPBACK for the next run: set to $ALLOW when ALLOW is set (even empty), unset otherwise.
set_allow() { if [[ -n "${ALLOW+x}" ]]; then export OSS_ALLOW_HTTP_LOOPBACK="$ALLOW"; else unset OSS_ALLOW_HTTP_LOOPBACK; fi; }

# $1 = config.json body, or the word NONE for no config file. Sets OUT and RC.
run_helper() {
    local T; T=$(mktemp -d); mkdir -p "$T/.oss"
    [[ "$1" == NONE ]] || printf '%s' "$1" > "$T/.oss/config.json"
    set_allow
    OUT=$(HOME="$T" "$SH" -c 'source "$1"; oss_api_url' _ "$ROOT/hooks/oss-api-curl.sh" 2>/dev/null); RC=$?
    rm -rf "$T"
}

for url in 'https://api.example.com' 'https://api.example.com/base'; do
    run_helper "{\"apiUrl\":\"$url\"}"
    if [[ $RC == 0 && "$OUT" == "$url" ]]; then pass "accepts '$url'"
    else fail "accepts '$url'" "rc=$RC out='$OUT'"; fi
done

# Plain http to a loopback API (T20, pen-test M2): any local process can take the port, so the key goes there
# only when the user opted in with OSS_ALLOW_HTTP_LOOPBACK=1 exactly. Otherwise: no URL, return code 2.
LOOPBACKS=('http://127.0.0.1:4100' 'http://localhost:4100' 'http://localhost' 'http://[::1]:4100/')
for url in "${LOOPBACKS[@]}"; do
    ALLOW=1 run_helper "{\"apiUrl\":\"$url\"}"
    if [[ $RC == 0 && "$OUT" == "$url" ]]; then pass "accepts '$url' with OSS_ALLOW_HTTP_LOOPBACK=1"
    else fail "accepts '$url' with OSS_ALLOW_HTTP_LOOPBACK=1" "rc=$RC out='$OUT'"; fi
    run_helper "{\"apiUrl\":\"$url\"}"
    if [[ $RC == 2 && -z "$OUT" ]]; then pass "refuses '$url' without the opt-in (rc 2, prints nothing)"
    else fail "refuses '$url' without the opt-in (rc 2, prints nothing)" "rc=$RC out='$OUT'"; fi
done
for allow in true 0 yes '' ' 1' '1 ' 01; do
    ALLOW="$allow" run_helper '{"apiUrl":"http://127.0.0.1:4100"}'
    if [[ $RC == 2 && -z "$OUT" ]]; then pass "OSS_ALLOW_HTTP_LOOPBACK='$allow' is not the opt-in (rc 2)"
    else fail "OSS_ALLOW_HTTP_LOOPBACK='$allow' is not the opt-in (rc 2)" "rc=$RC out='$OUT'"; fi
done
# Code 2 means only "loopback http without the opt-in": a URL refused for any other reason stays 1, so session
# start never tells the user to set the switch for a URL the switch would not let through.
for url in 'http://localhost:99999' 'http://localhost:4100@evil.example.com' 'http://evil.example.com' \
           'http://localhost.evil.com'; do
    run_helper "{\"apiUrl\":\"$url\"}"
    if [[ $RC == 1 && -z "$OUT" ]]; then pass "refuses '$url' with rc 1, not the opt-in code"
    else fail "refuses '$url' with rc 1, not the opt-in code" "rc=$RC out='$OUT'"; fi
done

for url in 'http://evil.example.com' 'http://localhost.evil.com' 'https://api.example.com/?x=' \
           'https://api.example.com/#' 'http://127.0.0.1@evil.example.com' \
           'http://localhost:4100@evil.example.com' 'ftp://api.example.com' 'https://'; do
    ALLOW=1 run_helper "{\"apiUrl\":\"$url\"}"
    if [[ $RC != 0 && -z "$OUT" ]]; then pass "refuses '$url' (non-zero, prints nothing)"
    else fail "refuses '$url' (non-zero, prints nothing)" "rc=$RC out='$OUT'"; fi
done

for cfg in '{"apiKey":"k"}' '{"apiKey":"k","apiUrl":""}' NONE; do
    run_helper "$cfg"
    if [[ $RC == 0 && "$OUT" == "$DEFAULT" ]]; then pass "missing/empty apiUrl ($cfg) gives the default API"
    else fail "missing/empty apiUrl ($cfg) gives the default API" "rc=$RC out='$OUT'"; fi
done

# A config.json that exists but jq cannot parse (T21, security S3): callers still grep the key out of it,
# so falling back to the default API would send a key meant for a dev API to production. No URL instead.
for cfg in '{"apiKey":"k","apiUrl":"https://dev.example.com"' '{"apiKey":"k","apiUrl":"https://dev.example.com",}' \
           'not json' '["https://dev.example.com"]'; do
    run_helper "$cfg"
    if [[ $RC != 0 && -z "$OUT" ]]; then pass "unparsable config ($cfg) gives no URL"
    else fail "unparsable config ($cfg) gives no URL" "rc=$RC out='$OUT'"; fi
done

# Without jq: node reads the config as one JSON object (T30; T21's grep reader refused nested objects), under
# the same rule, so a jq-less user with no apiUrl still reaches the default API and one with an apiUrl reaches
# theirs, never production.
# No jq: node reads the config (T30), so the no-jq PATH holds node.
NOJQ=$(mktemp -d); ln -s "$(command -v grep)" "$NOJQ/grep"; ln -s "$(command -v node)" "$NOJQ/node"
run_nojq() {
    local T; T=$(mktemp -d); mkdir -p "$T/.oss"
    printf '%s' "$1" > "$T/.oss/config.json"
    set_allow
    OUT=$(HOME="$T" PATH="$NOJQ" "$SH" -c 'source "$1"; oss_api_url' _ "$ROOT/hooks/oss-api-curl.sh" 2>/dev/null); RC=$?
    rm -rf "$T"
}
run_nojq '{"apiKey":"k"}'
[[ $RC == 0 && "$OUT" == "$DEFAULT" ]] && pass "no jq: no apiUrl gives the default API" || fail "no jq: no apiUrl gives the default API" "rc=$RC out='$OUT'"
run_nojq '{"apiKey":"k","apiUrl":null}'
[[ $RC == 0 && "$OUT" == "$DEFAULT" ]] && pass "no jq: null apiUrl gives the default API" || fail "no jq: null apiUrl gives the default API" "rc=$RC out='$OUT'"
run_nojq '{"apiKey":"k","apiUrl":"https://dev.example.com"}'
[[ $RC == 0 && "$OUT" == "https://dev.example.com" ]] && pass "no jq: a valid apiUrl is used" || fail "no jq: a valid apiUrl is used" "rc=$RC out='$OUT'"
ALLOW=1 run_nojq $'{\n  "apiKey": "k",\n  "apiUrl": "http://localhost:4100"\n}\n'
[[ $RC == 0 && "$OUT" == "http://localhost:4100" ]] && pass "no jq: a pretty-printed apiUrl is used" || fail "no jq: a pretty-printed apiUrl is used" "rc=$RC out='$OUT'"
run_nojq $'{\n  "apiKey": "k",\n  "apiUrl": "http://localhost:4100"\n}\n'
[[ $RC == 2 && -z "$OUT" ]] && pass "no jq: loopback http without the opt-in gives no URL (rc 2)" || fail "no jq: loopback http without the opt-in gives no URL (rc 2)" "rc=$RC out='$OUT'"
for cfg in '{"apiUrl":"http://evil.example.com"}' '{"apiUrl":443}' '{"apiUrl":"https://api.example.comé"}' \
           '{"apiUrl":"https://dev.example.com\u0000@evil.com"}' '{"apiUrl":"https://dev.example.com\"x"}'; do
    run_nojq "$cfg"
    if [[ $RC != 0 && -z "$OUT" ]]; then pass "no jq: refuses $(printf '%q' "$cfg")"
    else fail "no jq: refuses $(printf '%q' "$cfg")" "rc=$RC out='$OUT'"; fi
done
# Without jq the config is parsed as JSON (node, T30), so every config gets jq's answer: duplicate keys (the last
# wins in both), a line break inside the object, nested objects (a nested apiUrl is not the apiUrl), escapes,
# truncated files, arrays.
for cfg in '{"apiUrl":"https://a.example.com","apiUrl":"https://b.example.com"}' $'{"apiUrl":\n"https://dev.example.com"}' \
           '{"apiKey":"k","x":{"apiUrl":"https://dev.example.com"}}' '{"x":{"y":1},"apiUrl":"https://dev.example.com"}' \
           '{"apiUrl":"https:\/\/dev.example.com"}' '{"apiUrl":"https://dev\u002eexample.com"}' '{"apiUrl":"https://dev.example.com"' \
           '{"apiUrl":"https://dev.example.com",}' '["https://dev.example.com"]' '{"apiUrl":"https://dev.example.com"} {}' ''; do
    run_helper "$cfg"; JQ_OUT=$OUT; JQ_RC=$RC
    run_nojq "$cfg"
    if [[ $RC == "$JQ_RC" && "$OUT" == "$JQ_OUT" ]]; then pass "no jq: same answer as jq for $(printf '%q' "$cfg") (rc=$RC)"
    else fail "no jq: same answer as jq for $(printf '%q' "$cfg")" "jq rc=$JQ_RC out='$JQ_OUT'; no jq rc=$RC out='$OUT'"; fi
done
# A raw NUL byte in the file (not the \u0000 escape): zsh keeps it and its =~ stops there, so the shell would
# validate only the part before it. The no-jq reader (node) refuses it: not valid JSON, and not printable ASCII.
for rsh in /bin/bash /bin/zsh; do
    for raw in 'http://127.0.0.1\0@evil.com' 'http://127.0.0.1\0.evil.com'; do
        T=$(mktemp -d); mkdir -p "$T/.oss"
        printf "{\"apiUrl\":\"$raw\"}" > "$T/.oss/config.json"
        OUT=$(OSS_ALLOW_HTTP_LOOPBACK=1 HOME="$T" PATH="$NOJQ" "$rsh" -c 'source "$1"; oss_api_url' _ "$ROOT/hooks/oss-api-curl.sh" 2>/dev/null); RC=$?
        rm -rf "$T"
        if [[ $RC != 0 && -z "$OUT" ]]; then pass "no jq [${rsh##*/}]: refuses a raw NUL in $raw"
        else fail "no jq [${rsh##*/}]: refuses a raw NUL in $raw" "rc=$RC out=$(printf '%q' "$OUT")"; fi
    done
done
rm -rf "$NOJQ"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
