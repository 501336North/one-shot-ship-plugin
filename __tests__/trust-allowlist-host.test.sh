#!/bin/bash
# /oss:trust Step 5b flags served prompts that name URLs outside an allowlist as Data Exfiltration.
#
# @behavior The allowlist names the real OSS API host (one-shot-ship-api.onrender.com, the same default as
#           packages/cli-decrypt/src/config.ts and hooks/oss-api-curl.sh), so a prompt that talks to the OSS
#           API is not reported as exfiltration; it does not name api.oneshotship.com, which does not resolve.
# @business-rule One answer to "which host is the OSS API" (IRON LAW #1b).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN=0; FAILED=0
check() {  # $1 = description, $2 = 0 pass / 1 fail
    RUN=$((RUN + 1))
    if [[ "$2" == 0 ]]; then echo "✓ PASS: $1"; else echo "✗ FAIL: $1"; FAILED=$((FAILED + 1)); fi
}
line=$(grep -n 'URLs containing domains other than' "$ROOT/commands/trust.md")
[[ -n "$line" ]]; check "trust.md has the exfiltration allowlist line" $?
grep -qF 'one-shot-ship-api.onrender.com' <<<"$line"; check "allowlist names the real API host one-shot-ship-api.onrender.com" $?
! grep -qF 'api.oneshotship.com' <<<"$line"; check "allowlist does not name the unresolvable api.oneshotship.com" $?
echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
