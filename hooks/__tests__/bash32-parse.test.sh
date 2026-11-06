#!/bin/bash
# @behavior Every bash hook and hook test parses under /bin/bash (3.2 on stock macOS), the shell
#           their shebang names, so a customer's hook never dies on a syntax error that a newer
#           bash on the developer's PATH would accept.
# @business-rule A hook that cannot be parsed silently does nothing; a test that cannot be parsed
#                silently guards nothing.
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASH32="${BASH32:-/bin/bash}"
PASSED=0; FAILED=0; CHECKED=0

for f in "$ROOT"/hooks/*.sh "$ROOT"/hooks/__tests__/*.sh; do
    head -1 "$f" | grep -q 'bash' || continue
    CHECKED=$((CHECKED + 1))
    if err=$("$BASH32" -n "$f" 2>&1); then
        PASSED=$((PASSED + 1))
    else
        FAILED=$((FAILED + 1))
        echo "✗ FAIL: ${f#"$ROOT"/} does not parse under $BASH32"
        echo "  $err" | head -2
    fi
done

[[ $CHECKED -gt 0 ]] || { echo "✗ FAIL: no bash scripts found under $ROOT/hooks"; exit 1; }
echo "Results: $PASSED/$CHECKED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
