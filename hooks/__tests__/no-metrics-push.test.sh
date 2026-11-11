#!/bin/bash
# The plugin ships no metrics push (plugin-main-fixes Task 3, D2).
#
# @behavior A plugin install contains no hooks/oss-push-metrics.sh, and no hook, command, skill or
#           hooks.json entry names it, so nothing can send command metrics to the API from the plugin.
# @business-rule D2 (owner, 2026-11-10): the dormant metrics push is deleted, not wired. The G1-G4
#           timeline already gives the dashboard its data, and a hook that sends the API key but is
#           never called is code we ship and must secure for nothing.
#
# Usage: /bin/bash hooks/__tests__/no-metrics-push.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running no-metrics-push tests..."

[[ ! -e "$ROOT/hooks/oss-push-metrics.sh" ]] \
    && pass "the plugin has no hooks/oss-push-metrics.sh" \
    || fail "the plugin has no hooks/oss-push-metrics.sh" "the file still exists"

# Hooks, commands, skills and hooks.json: anything that could call it. Test files are left out: the tests
# that dropped it as a site say so in a comment (D3), and this file names it on purpose.
refs=$(grep -rlE 'oss-push-metrics|push-metrics' --exclude-dir=__tests__ \
    "$ROOT/hooks" "$ROOT/commands" "$ROOT/skills" "$ROOT/hooks.json" 2>/dev/null)
[[ -z "$refs" ]] \
    && pass "no hook, command, skill or hooks.json entry references the metrics push" \
    || fail "no hook, command, skill or hooks.json entry references the metrics push" "referenced in: $(echo $refs | sed "s#$ROOT/##g")"

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
