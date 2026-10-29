#!/bin/bash
# oss-notification.sh: a saved notification style of `telegram` behaves exactly as `visual`.
#
# @behavior A user whose settings still say style "telegram" (the retired Telegram bot) gets the same
#           "Ready" notification as a visual user: the status-line notice and the local popup.
# @business-rule The Telegram style is gone; an old saved value reads as `visual`, nothing else.
#
# Usage: ./hooks/__tests__/oss-notification-style.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy ./hooks/__tests__/oss-notification-style.test.sh   (mutants)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
HOOK="${HOOKS_UNDER_TEST:-$ROOT/hooks}/oss-notification.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
source "$ROOT/hooks/__tests__/lib/warm-stub.sh"
echo "Running oss-notification-style tests..."

# Stubs made and warmed once (macOS scans each new executable on its first exec, 0.3-60 s): fake
# node / terminal-notifier / say / afplay that record their calls into the current case's dir, $SHIM.
KS=$(mktemp -d); KS=$(cd "$KS" && pwd -P)
trap 'rm -rf "$KS"' EXIT
STUBS_WARM=y
for b in node terminal-notifier say afplay; do
    warm_stub "$KS/bin/$b" "echo \"$b \${*##*/}\" >> \"\$SHIM/calls\"" || STUBS_WARM=n
done
if [[ $STUBS_WARM != y ]]; then echo "✗ FAIL: stub warm-up — a stub did not run"; exit 1; fi
# Sandbox: temp HOME and a fake plugin root; $T/bin is the stub dir. The hook backgrounds the popup
# (`&>/dev/null &` redirects only fds 1 and 2), so the popup job inherits fd 3: with `3>&1` inside the
# substitution, $(...) returns only when every job the hook started has exited. The calls are read
# after that - no polling, no sleeps - so a late call is counted and a missing one is really missing.
run_style() {
    local style="$1" T _wait
    T=$(mktemp -d)
    mkdir -p "$T/home/.oss" "$T/plugin/watcher/dist/cli"
    ln -s "$KS/bin" "$T/bin"
    : > "$T/plugin/watcher/dist/cli/update-workflow-state.js"
    printf '{"notifications":{"style":"%s"}}\n' "$style" > "$T/home/.oss/settings.json"
    _wait=$(cd "$T" && SHIM="$T" HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" PATH="$T/bin:$PATH" \
        "$SH" "$HOOK" 3>&1 </dev/null >/dev/null 2>&1)
    sort "$T/calls" 2>/dev/null
    rm -rf "$T"
}

# 1. style telegram produces the same calls as style visual (anchor: visual makes both calls).
visual=$(run_style visual)
telegram=$(run_style telegram)
if grep -q '^node .*setNotification Ready' <<<"$visual" && grep -q '^terminal-notifier' <<<"$visual"; then
    pass "visual style sets the Ready notice and shows the popup"
else fail "visual style sets the Ready notice and shows the popup" "calls=$(tr '\n' '|' <<<"$visual")"; fi
if [[ "$telegram" == "$visual" ]]; then
    pass "a saved telegram style behaves exactly as visual"
else fail "a saved telegram style behaves exactly as visual" "visual=$(tr '\n' '|' <<<"$visual") telegram=$(tr '\n' '|' <<<"$telegram")"; fi

# 2. the hook has no Telegram branch or wording left; the one allowed mention is the legacy style
#    sharing the visual branch (anchor: the real hook was read).
lines=$(wc -l < "$HOOK" | tr -d ' ')
others=$(grep -i telegram "$HOOK" | grep -v '^ *"visual"|"telegram")$')
if [[ "$lines" -gt 20 ]] && [[ -z "$others" ]]; then
    pass "oss-notification.sh has no Telegram code left beyond the visual mapping"
else fail "oss-notification.sh has no Telegram code left beyond the visual mapping" "lines=$lines hits=$(tr '\n' '|' <<<"$others")"; fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
