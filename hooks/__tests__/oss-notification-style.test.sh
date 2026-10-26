#!/bin/bash
# oss-notification.sh: a saved notification style of `telegram` behaves exactly as `visual`.
#
# @behavior A user whose settings still say style "telegram" (the retired Telegram bot) gets the same
#           "Ready" notification as a visual user: the status-line notice and the local popup.
# @business-rule The Telegram style is gone; an old saved value reads as `visual`, nothing else.
#
# Usage: ./hooks/__tests__/oss-notification-style.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
HOOK="$ROOT/hooks/oss-notification.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-notification-style tests..."

# Sandbox: temp HOME, a fake plugin root, and fake node / terminal-notifier / say / afplay that record
# their calls (the hook backgrounds the popup, so we wait for its line, bounded).
run_style() {
    local style="$1" T
    T=$(mktemp -d)
    mkdir -p "$T/home/.oss" "$T/plugin/watcher/dist/cli" "$T/bin"
    : > "$T/plugin/watcher/dist/cli/update-workflow-state.js"
    for b in node terminal-notifier say afplay; do
        printf '#!/bin/bash\necho "%s ${*##*/}" >> "%s/calls"\n' "$b" "$T" > "$T/bin/$b"
        chmod +x "$T/bin/$b"
    done
    printf '{"notifications":{"style":"%s"}}\n' "$style" > "$T/home/.oss/settings.json"
    (cd "$T" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" PATH="$T/bin:$PATH" "$SH" "$HOOK" </dev/null >/dev/null 2>&1)
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
        grep -q '^terminal-notifier' "$T/calls" 2>/dev/null && break
        /bin/sleep 0.1
    done
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
