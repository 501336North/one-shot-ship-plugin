#!/bin/bash
# The plugin's `npm test` runs every shell test file and fails when any one fails (D6).
#
# @behavior The ship merge step runs `npm test` at the repo root; it passes only when every
#           `__tests__/*.test.sh` file in the plugin passes on its own, and a failure names the file.
# @business-rule D6 (owner, 2026-11-11): the plugin repo gets a root package.json so /oss:ship --merge can
#           test and merge plugin PRs. The watcher's vitest suite is not part of it (its setup kills OSS
#           processes machine-wide).
#
# Usage: /bin/bash scripts/__tests__/run-shell-tests.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="$ROOT/scripts/run-shell-tests.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running run-shell-tests tests..."

F=$(mktemp -d); trap 'rm -rf "$F"' EXIT
mkdir -p "$F/__tests__" "$F/hooks/__tests__" "$F/watcher/node_modules/x/__tests__"
printf 'exit 0\n' > "$F/__tests__/ok.test.sh"
printf 'exit 0\n' > "$F/hooks/__tests__/also-ok.test.sh"
printf 'exit 1\n' > "$F/watcher/node_modules/x/__tests__/vendored.test.sh"

out=$(/bin/bash "$RUNNER" "$F" 2>&1); rc=$?
[[ $rc -eq 0 ]] && pass "all passing test files: exit 0 (node_modules is never run)" \
    || fail "all passing test files: exit 0 (node_modules is never run)" "rc=$rc out=$out"

printf 'exit 3\n' > "$F/hooks/__tests__/broken.test.sh"
out=$(/bin/bash "$RUNNER" "$F" 2>&1); rc=$?
[[ $rc -ne 0 ]] && pass "one failing test file: non-zero exit" || fail "one failing test file: non-zero exit" "rc=0"
[[ "$out" == *"hooks/__tests__/broken.test.sh"* ]] && pass "the failing file is named" \
    || fail "the failing file is named" "out=$out"

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
