#!/bin/bash
# oss_api_url_syntax (hooks/oss-api-curl.sh) answers the shared apiUrl SYNTAX table the same way getApiUrl does.
# (Trust - which hosts may receive the key - is oss-api-trust.test.sh, over trusted-api-url-cases.json.)
#
# @behavior For every case in packages/cli-decrypt/test/fixtures/api-url-cases.json, oss_api_url sourced
#           in bash AND in zsh accepts (prints the value, or the default API when missing/null/empty) or
#           refuses (prints nothing, returns non-zero) exactly as the table says.
# @business-rule One rule for "may the API key go to this apiUrl", identical in the TS CLI and the hooks.
#
# Usage: ./hooks/__tests__/oss-api-url-cases.test.sh   (needs jq; SHELLS="bash zsh" to override)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CASES="$ROOT/packages/cli-decrypt/test/fixtures/api-url-cases.json"
DEFAULT="https://one-shot-ship-api.onrender.com"
SHELLS="${SHELLS:-/bin/bash /bin/zsh}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

command -v jq >/dev/null 2>&1 || { echo "✗ FAIL: jq is required to read the case table"; exit 1; }

N=$(jq length "$CASES")
for SH in $SHELLS; do
    for ((i = 0; i < N; i++)); do
        why=$(jq -r ".[$i].why" "$CASES")
        accept=$(jq -r ".[$i].accept" "$CASES")
        # Accepted values are printable ASCII, so jq -r prints them exactly.
        expected=$(jq -r ".[$i] | if (.apiUrl // \"\") == \"\" then \"$DEFAULT\" else .apiUrl end" "$CASES")
        T=$(mktemp -d); mkdir -p "$T/.oss"
        jq -c ".[$i] | if has(\"apiUrl\") then {apiUrl} else {} end" "$CASES" > "$T/.oss/config.json"
        OUT=$(HOME="$T" "$SH" -c 'source "$1"; oss_api_url_syntax' _ "$ROOT/hooks/oss-api-curl.sh" 2>/dev/null); RC=$?
        rm -rf "$T"
        name="[$(basename "$SH")] case $i: $why"
        if [[ "$accept" == true ]]; then
            if [[ $RC == 0 && "$OUT" == "$expected" ]]; then pass "accepts — $name"
            else fail "accepts — $name" "rc=$RC out=$(printf '%q' "$OUT")"; fi
        else
            if [[ $RC != 0 && -z "$OUT" ]]; then pass "refuses — $name"
            else fail "refuses — $name" "rc=$RC out=$(printf '%q' "$OUT")"; fi
        fi
    done
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
