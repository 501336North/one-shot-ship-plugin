#!/bin/bash
# The API calls that /oss:login, /oss:status and /oss:workflows make (not prompt fetches) go to the API the OSS
# config names, with the key on curl's stdin (release channels US-002; follow-up #14).
#
# @behavior Each call is ONE allowlisted command, `~/.oss/hooks/oss-value.sh api <endpoint>`: it takes the address
#           from oss_api_url and the key from oss_api_key (one rule, one config file) and hands the key to curl on
#           stdin. None of these commands names the production host or an /api/v1/ path itself, and none asks the
#           model to put the key in an Authorization header.
# @business-rule On STAGING the key goes to staging, never production; the key never enters the model's
#           context or a process command line; and the call needs no approval prompt (R5-1: one allowlisted
#           command, no $(...) chained with &&).
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
check "no /api/v1/ path is spelled out in these commands (the api verb owns the endpoint list)" \
    "$(grep -n '/api/v1/' "${FILES[@]}")"
for want in "commands/login.md|api prompts/claude-md" "commands/status.md|api auth/verify" \
            "commands/workflows.md|api workflows" "commands/workflows.md|api workflow"; do
    f=${want%%|*}; v=${want#*|}
    check "$f calls the API as the single command ~/.oss/hooks/oss-value.sh $v" \
        "$(grep -qxF "~/.oss/hooks/oss-value.sh $v" "$f" || echo "missing: ~/.oss/hooks/oss-value.sh $v")"
done
check "no command reads the key with its own grep of config.json (use oss_api_key)" \
    "$(grep -n 'grep -o .\{0,4\}"apiKey"' "${FILES[@]}")"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
