#!/bin/bash
# The watcher test files must type-check, like watcher/src does (T75e).
#
# @behavior vitest strips types without checking them, so a mock that no longer matches the interface it
#           stands in for still "passes" while it tests a shape the product never has. This guard runs the
#           repo's own tsc over watcher/test with watcher/tsconfig.test.json (strict, no emit) and fails,
#           listing the errors, on any type error in a test file or helper.
# @business-rule A test that type-checks against the real interfaces breaks when those interfaces change,
#           instead of drifting silently (T75e found 105 such errors, e.g. execAsync mocks with the wrong
#           signature).
#
# Usage: ./hooks/__tests__/watcher-tests-typecheck.test.sh   (needs `npm ci` in watcher/)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
W="$ROOT/watcher"
TSC="$W/node_modules/.bin/tsc"
echo "Running watcher-tests-typecheck test..."
if [[ ! -x "$TSC" ]]; then
    echo "✗ FAIL: typescript not installed ($TSC missing) — run: (cd watcher && npm ci)"
    exit 1
fi
if [[ ! -f "$W/tsconfig.test.json" ]]; then
    echo "✗ FAIL: watcher/tsconfig.test.json missing"
    exit 1
fi
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT
if "$TSC" --noEmit -p "$W/tsconfig.test.json" >"$LOG" 2>&1; then
    echo "✓ PASS: watcher/test type-checks (tsc --noEmit -p watcher/tsconfig.test.json)"
    exit 0
fi
n=$(grep -c 'error TS' "$LOG")
echo "✗ FAIL: $n type error(s) in watcher tests (cd watcher && npx tsc --noEmit -p tsconfig.test.json):"
grep 'error TS' "$LOG" | head -40
exit 1
