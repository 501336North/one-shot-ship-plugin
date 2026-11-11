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

# Files anywhere under $1 that name the push or the analyzer. Test files are left out (the tests that dropped
# them as a site say so in a comment, D3, and this file names them on purpose), and so are .git, node_modules
# and the .oss dev docs, which record the decision.
metrics_refs() {  # only the repo-root .oss is left out (ship round 2): a .oss folder deeper down is scanned
    local f
    while IFS= read -r -d '' f; do
        case "$f" in "$1/.oss/"* | */__tests__/*.test.sh) ;; *) printf '%s\n' "$f" ;; esac
    done < <(grep -rlE --null 'oss-push-metrics|push-metrics|oss-log-analyzer|pending-metrics' \
        --exclude-dir=.git --exclude-dir=node_modules "$1")
}

refs=$(metrics_refs "$ROOT")
[[ -z "$refs" ]] \
    && pass "nothing in the repo references the metrics push" \
    || fail "nothing in the repo references the metrics push" "referenced in: $(echo $refs | sed "s#$ROOT/##g")"

# D4 (owner, 2026-11-11): the log analyzer existed only to feed the push (`oss-log-analyzer.sh build |
# oss-push-metrics.sh`) and has no other caller, so it goes too.
[[ ! -e "$ROOT/hooks/oss-log-analyzer.sh" ]] \
    && pass "the plugin has no hooks/oss-log-analyzer.sh (it only fed the push)" \
    || fail "the plugin has no hooks/oss-log-analyzer.sh (it only fed the push)" "the file still exists"
refs=$(metrics_refs "$ROOT")
[[ -z "$refs" ]] \
    && pass "nothing in the repo references the log analyzer" \
    || fail "nothing in the repo references the log analyzer" "referenced in: $(echo $refs | sed "s#$ROOT/##g")"

# Ship round 1 (pen test): a reference anywhere in the repo counts (bin/, agents/, scripts/, watcher/src ...),
# not only in hooks, commands, skills and hooks.json. Checked on a small fixture tree.
X=$(mktemp -d); trap 'rm -rf "$X"' EXIT
for place in bin/oss-x agents/a.md scripts/s.sh watcher/src/w.ts hooks/.oss/run.sh hooks/__tests__/lib/helper.sh hooks/push.test.sh; do
    rm -rf "${X:?}"/*; mkdir -p "$X/$(dirname "$place")"
    printf 'run ~/.oss/hooks/oss-push-metrics.sh\n' > "$X/$place"
    [[ -n "$(metrics_refs "$X")" ]] && pass "a metrics-push reference in $place is caught" \
        || fail "a metrics-push reference in $place is caught" "not flagged"
done
rm -rf "${X:?}"/*; mkdir -p "$X/hooks/__tests__" "$X/node_modules/p"
printf 'oss-push-metrics.sh\n' > "$X/hooks/__tests__/t.test.sh"; printf 'oss-log-analyzer.sh\n' > "$X/node_modules/p/i.js"
[[ -z "$(metrics_refs "$X")" ]] && pass "test files and node_modules may name them" || fail "test files and node_modules may name them" "flagged: $(metrics_refs "$X")"

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
