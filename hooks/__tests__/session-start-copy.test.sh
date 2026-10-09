#!/bin/bash
# Session start copies the decrypt installer AND its committed manifest into ~/.oss/hooks (behavioural).
# Usage: ./hooks/__tests__/session-start-copy.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; ((RUN++)); }
fail() { echo "✗ FAIL: $1 — $2"; ((RUN++)); ((FAILED++)); }

# F10: the manifest is copied, readable, and NOT made executable (it is data, not a script)
T=$(mktemp -d)
HOME="$T" CLAUDE_PLUGIN_ROOT="$ROOT" bash "$ROOT/hooks/oss-session-start.sh" >/dev/null 2>&1 </dev/null
M="$T/.oss/hooks/oss-decrypt-checksums.txt"
if [[ -f "$M" && ! -x "$M" && -x "$T/.oss/hooks/ensure-decrypt-cli.sh" ]]; then pass "manifest copied as data (not executable), hook executable"
else fail "manifest copied as data" "exists=$([[ -f $M ]] && echo y || echo n) exec=$([[ -x $M ]] && echo y || echo n)"; fi
rm -rf "$T"

# F11: every session-start variant that copies the installer also copies its manifest
for f in "$ROOT"/hooks/oss-session-start*.sh; do
  if grep -q '"ensure-decrypt-cli.sh"' "$f" && ! grep -q '"oss-decrypt-checksums.txt"' "$f"; then
    fail "$(basename "$f") copies the manifest" "copies ensure-decrypt-cli.sh without oss-decrypt-checksums.txt"
  else pass "$(basename "$f") copies the manifest with the installer"; fi
done
echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
