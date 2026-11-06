#!/bin/bash
# oss_api_url (hooks/oss-api-curl.sh) answers the shared apiUrl case table the same way getApiUrl does.
#
# @behavior For every case in packages/cli-decrypt/test/fixtures/api-url-cases.json, oss_api_url sourced
#           in bash AND in zsh accepts (prints the value, or the default API when missing/null/empty) or
#           refuses (prints nothing, returns non-zero) exactly as the table says.
#           Each case runs twice per shell: with jq, and with a PATH that has no jq (T21), where the hook reads
#           the flat "apiUrl": "..." shape itself and must answer every case the same way.
#           The table is the literal URL rule, so it runs with OSS_ALLOW_HTTP_LOOPBACK=1; it runs again without
#           the opt-in, where every accepted plain-http (loopback) case must be refused with rc 2 (T20).
# @business-rule One rule for "may the API key go to this apiUrl", identical in the TS CLI and the hooks,
#           with or without jq. The hooks also need the explicit opt-in before the key goes over plain http.
#
# Usage: ./hooks/__tests__/oss-api-url-cases.test.sh   (needs jq; SHELLS="bash zsh" to override)
set -uo pipefail
# The hooks read the API key and URL from $OSS_CONFIG_DIR/config.json: a developer's exported
# override must not lead them to the real key and the real API (T19).
unset OSS_CONFIG_DIR OSS_MANIFEST_URL
unset OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CASES="$ROOT/packages/cli-decrypt/test/fixtures/api-url-cases.json"
DEFAULT="https://one-shot-ship-api.onrender.com"
SHELLS="${SHELLS:-/bin/bash /bin/zsh}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

command -v jq >/dev/null 2>&1 || { echo "✗ FAIL: jq is required to read the case table"; exit 1; }

N=$(jq length "$CASES")
# No jq: node reads the config (T30), so the no-jq PATH holds node.
NOJQ=$(mktemp -d); ln -s "$(command -v grep)" "$NOJQ/grep"; ln -s "$(command -v node)" "$NOJQ/node"
for SH in $SHELLS; do
  for MODE in jq nojq; do
    HPATH="$PATH"; [[ "$MODE" == nojq ]] && HPATH="$NOJQ"
    for ((i = 0; i < N; i++)); do
        why=$(jq -r ".[$i].why" "$CASES")
        accept=$(jq -r ".[$i].accept" "$CASES")
        # Accepted values are printable ASCII, so jq -r prints them exactly.
        expected=$(jq -r ".[$i] | if (.apiUrl // \"\") == \"\" then \"$DEFAULT\" else .apiUrl end" "$CASES")
        T=$(mktemp -d); mkdir -p "$T/.oss"
        jq -c ".[$i] | if has(\"apiUrl\") then {apiUrl} else {} end" "$CASES" > "$T/.oss/config.json"
        OUT=$(OSS_ALLOW_HTTP_LOOPBACK=1 HOME="$T" PATH="$HPATH" "$SH" -c 'source "$1"; oss_api_url' _ "$ROOT/hooks/oss-api-curl.sh" 2>/dev/null); RC=$?
        OUT0=$(HOME="$T" PATH="$HPATH" "$SH" -c 'source "$1"; oss_api_url' _ "$ROOT/hooks/oss-api-curl.sh" 2>/dev/null); RC0=$?
        rm -rf "$T"
        name="[$(basename "$SH"), $MODE] case $i: $why"
        if [[ "$accept" == true && "$expected" == http://* ]]; then
            if [[ $RC0 == 2 && -z "$OUT0" ]]; then pass "refuses without OSS_ALLOW_HTTP_LOOPBACK=1 (rc 2) — $name"
            else fail "refuses without OSS_ALLOW_HTTP_LOOPBACK=1 (rc 2) — $name" "rc=$RC0 out=$(printf '%q' "$OUT0")"; fi
        elif [[ $RC0 != "$RC" || "$OUT0" != "$OUT" ]]; then
            fail "same answer without the opt-in — $name" "rc=$RC0/$RC out=$(printf '%q' "$OUT0")"
        fi
        if [[ "$accept" == true ]]; then
            if [[ $RC == 0 && "$OUT" == "$expected" ]]; then pass "accepts — $name"
            else fail "accepts — $name" "rc=$RC out=$(printf '%q' "$OUT")"; fi
        else
            if [[ $RC != 0 && -z "$OUT" ]]; then pass "refuses — $name"
            else fail "refuses — $name" "rc=$RC out=$(printf '%q' "$OUT")"; fi
        fi
    done
  done
done
rm -rf "$NOJQ"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
