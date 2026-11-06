#!/bin/bash
# oss_api_url and oss_api_key (hooks/oss-api-curl.sh) read the same config file the CLI reads.
#
# @behavior With OSS_CONFIG_DIR set, both the API key and the API URL come from $OSS_CONFIG_DIR/config.json;
#           unset (or empty), both come from ~/.oss/config.json. Without jq, the key is still read and so is a
#           flat top-level apiUrl (T21: a default here would send a dev API's key to production); duplicate
#           or nested apiUrl keys give no URL at all, so they never decide where the key goes.
# @business-rule The key and the URL it is sent to come from one config file - the one getConfigDir in
#           packages/cli-decrypt/src/config.ts picks - never a key from one file and a URL from another.
#
# Usage: ./hooks/__tests__/oss-api-config-dir.test.sh
#        BASH_UNDER_TEST=/opt/local/bin/bash ./hooks/__tests__/oss-api-config-dir.test.sh
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
expect() {  # $1 = description, $2 = expected, $3 = actual
    if [[ "$3" == "$2" ]]; then pass "$1"; else fail "$1" "expected '$2', got '$3'"; fi
}
DEFAULT="https://one-shot-ship-api.onrender.com"

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home/.oss" "$T/alt"
printf '%s' '{"apiKey":"K1","apiUrl":"https://u1.example.com"}' > "$T/home/.oss/config.json"
printf '%s' '{"apiKey":"K2","apiUrl":"https://u2.example.com"}' > "$T/alt/config.json"

# A PATH with every command on the real PATH except jq (a symlink farm), for the no-jq branch.
mkdir -p "$T/nojq"
IFS=: read -r -a dirs <<< "$PATH"
for d in "${dirs[@]}"; do
    [[ -d "$d" ]] || continue
    for f in "$d"/*; do
        [[ -x "$f" && "${f##*/}" != jq && ! -e "$T/nojq/${f##*/}" ]] && ln -s "$f" "$T/nojq/${f##*/}" 2>/dev/null
    done
done
NOJQ="$T/nojq"

helper() {  # $1 = function, $2 = OSS_CONFIG_DIR value, $3 = PATH
    HOME="$T/home" OSS_CONFIG_DIR="$2" PATH="$3" "$SH" -c 'source "$1"; '"$1" _ "$ROOT/hooks/oss-api-curl.sh" 2>/dev/null
}

if command -v jq >/dev/null 2>&1; then
    expect "OSS_CONFIG_DIR set: oss_api_url reads its config" "https://u2.example.com" "$(helper oss_api_url "$T/alt" "$PATH")"
    expect "OSS_CONFIG_DIR set: oss_api_key reads its config" "K2" "$(helper oss_api_key "$T/alt" "$PATH")"
    expect "OSS_CONFIG_DIR unset: oss_api_url reads ~/.oss" "https://u1.example.com" "$(helper oss_api_url "" "$PATH")"
    expect "OSS_CONFIG_DIR unset: oss_api_key reads ~/.oss" "K1" "$(helper oss_api_key "" "$PATH")"
    for cfg in '{"apiUrl":"https://u.example.com"}' '{"apiKey":""}' '{"apiKey":7}' '{"apiKey":null}' 'not json'; do
        mkdir -p "$T/bad"; printf '%s' "$cfg" > "$T/bad/config.json"
        out=$(helper 'oss_api_key; echo "rc=$?"' "$T/bad" "$PATH")
        expect "oss_api_key with $cfg: prints nothing, returns 1" "rc=1" "$out"
    done
else
    fail "jq branch" "jq not installed"
fi

if PATH="$NOJQ" command -v jq >/dev/null 2>&1; then
    fail "no-jq branch" "could not hide jq"
else
    expect "no jq: a custom apiUrl is used (from OSS_CONFIG_DIR)" "https://u2.example.com" "$(helper oss_api_url "$T/alt" "$NOJQ")"
    expect "no jq: oss_api_key still reads the key (from OSS_CONFIG_DIR)" "K2" "$(helper oss_api_key "$T/alt" "$NOJQ")"
    expect "no jq: oss_api_key still reads the key (from ~/.oss)" "K1" "$(helper oss_api_key "" "$NOJQ")"
    # Without jq the config is parsed as JSON (node, T30), as jq parses it: the last of duplicate keys wins,
    # and a nested apiUrl is not the apiUrl.
    mkdir -p "$T/dup"; printf '%s' '{"apiKey":"K","apiUrl":"https://a.example.com","apiUrl":"http://evil.example.com"}' > "$T/dup/config.json"
    expect "no jq: duplicate apiUrl keys: the last one (refused here) is the apiUrl" "rc=1" "$(helper 'oss_api_url; echo "rc=$?"' "$T/dup" "$NOJQ")"
    printf '%s' '{"apiKey":"K","x":{"apiUrl":"http://evil.example.com"},"apiUrl":"https://a.example.com"}' > "$T/dup/config.json"
    expect "no jq: a nested apiUrl is not the apiUrl" "https://a.example.com" "$(helper oss_api_url "$T/dup" "$NOJQ")"
fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
