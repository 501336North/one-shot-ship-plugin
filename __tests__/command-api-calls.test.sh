#!/bin/bash
# The API calls that /oss:login, /oss:status and /oss:workflows make (not prompt fetches) go to the API the OSS
# config names, with the key on curl's stdin (release channels US-002; follow-up #14).
#
# @behavior Each call is one shell step: `u=$(oss_api_url)` and `k=$(oss_api_key)` (the one rule and the one
#           config file, hooks/oss-api-curl.sh), then `oss_api_curl "$k" … "$u/api/v1/…"`. None of these commands
#           names the production host, and none asks the model to put the key in an Authorization header itself.
# @business-rule On STAGING the key goes to staging, never production; the key never enters the model's
#           context or a process command line.
#
# Usage: ./__tests__/command-api-calls.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILES=(commands/login.md commands/status.md commands/workflows.md)
RUN=0; FAILED=0
check() {  # $1 = description, $2 = offending lines (empty = pass)
    RUN=$((RUN + 1))
    if [[ -z "$2" ]]; then echo "✓ PASS: $1"; else echo "✗ FAIL: $1"; printf '%s\n' "$2" | sed 's/^/    /'; FAILED=$((FAILED + 1)); fi
}
cd "$ROOT" || exit 1

check "no production API host in these commands (the address comes from oss_api_url)" \
    "$(grep -nF 'one-shot-ship-api.onrender.com' "${FILES[@]}")"
check "no step asks the model to send the key in an Authorization header" \
    "$(grep -nF 'Authorization: Bearer {apiKey}' "${FILES[@]}")"
check "every /api/v1/ call is made against \$u, the address oss_api_url printed" \
    "$(grep -n '/api/v1/' "${FILES[@]}" | grep -vF '"$u/api/v1/')"
for f in "${FILES[@]}"; do
    if grep -q '/api/v1/' "$f"; then
        missing=""
        grep -qF 'u=$(oss_api_url)' "$f" || missing="$missing u=\$(oss_api_url)"
        grep -qF 'k=$(oss_api_key)' "$f" || missing="$missing k=\$(oss_api_key)"
        grep -qF 'oss_api_curl "$k"' "$f" || missing="$missing oss_api_curl \"\$k\""
        check "$f takes the address and key from the helpers and calls through oss_api_curl" "${missing# }"
    fi
done
check "no command reads the key with its own grep of config.json (use oss_api_key)" \
    "$(grep -n 'grep -o .\{0,4\}"apiKey"' "${FILES[@]}")"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
