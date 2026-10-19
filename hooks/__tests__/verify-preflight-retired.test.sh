#!/bin/bash
# Retirement guard: hooks/verify-preflight.sh is gone, and nothing in the plugin names it.
#
# @behavior A plugin install contains no verify-preflight.sh, and no command, hook, agent,
#           doc or test tells anyone to run it.
# @business-rule The script could not pass: its full mode exited 1 on every clean repo (the
#           console.log `find | xargs grep | wc` aborts under `set -euo pipefail` when grep
#           matches nothing) and every mode exited 2 on macOS /bin/bash 3.2 (`declare -A`).
#           Served /oss:ship stopped calling it (AgenticDevWorkflow served-paths-fix T3b) and no
#           plugin file calls it, so it is deleted rather than fixed. Re-adding a reference would
#           route customers to a script that does not exist.
#
# Usage: ./hooks/__tests__/verify-preflight-retired.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SELF="hooks/__tests__/verify-preflight-retired.test.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; ((RUN++)); }
fail() { echo "✗ FAIL: $1 — $2"; ((RUN++)); ((FAILED++)); }

# Plugin files that name $1: tracked + untracked-not-ignored, excluding this guard itself.
files_naming() {
  (cd "$ROOT" && git ls-files -co --exclude-standard -z | xargs -0 grep -lF -- "$1" 2>/dev/null) | grep -vxF "$SELF" || true
}

# 1. The script itself is gone
if [[ -e "$ROOT/hooks/verify-preflight.sh" ]]; then
  fail "hooks/verify-preflight.sh is deleted" "it still exists"
else
  pass "hooks/verify-preflight.sh is deleted"
fi

# 2. Control (anti-vacuity): the scan finds a hook that IS referenced, so an empty result below is real
control=$(files_naming "learn-extractor.sh")
if [[ -n "$control" ]]; then
  pass "control: the scan finds files naming learn-extractor.sh"
else
  fail "control: the scan finds files naming learn-extractor.sh" "found none, so the scan is not scanning"
fi

# 3. No plugin file references it
refs=$(files_naming "verify-preflight")
if [[ -z "$refs" ]]; then
  pass "no plugin file references verify-preflight"
else
  fail "no plugin file references verify-preflight" "referenced by: $(echo "$refs" | tr '\n' ' ')"
fi

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
