#!/bin/bash
# oss-stop.sh: a saved notification style of `telegram` behaves exactly as `visual`.
#
# @behavior A user whose settings still say style "telegram" (the retired Telegram bot) gets the same
#           "Done" popup when Claude finishes as a visual user does.
# @business-rule The Telegram style is gone; an old saved value reads as `visual`, nothing else.
#
# Usage: ./hooks/__tests__/oss-stop-telegram-style.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
HOOK="$ROOT/hooks/oss-stop.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-stop-telegram-style tests..."

# Sandbox: temp HOME with settings.json, and fake terminal-notifier / osascript / say / afplay that
# record their calls (say and afplay are backgrounded by the hook, so wait briefly, bounded).
run_style() {
    local style="$1" T
    T=$(mktemp -d)
    mkdir -p "$T/home/.oss" "$T/bin"
    for b in terminal-notifier osascript say afplay; do
        printf '#!/bin/bash\necho "%s $*" >> "%s/calls"\n' "$b" "$T" > "$T/bin/$b"
        chmod +x "$T/bin/$b"
    done
    printf '{"notifications":{"style":"%s"}}\n' "$style" > "$T/home/.oss/settings.json"
    (cd "$T" && HOME="$T/home" PATH="$T/bin:$PATH" "$SH" "$HOOK" </dev/null >/dev/null 2>&1)
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        [[ -s "$T/calls" ]] && break
        /bin/sleep 0.1
    done
    sort "$T/calls" 2>/dev/null
    rm -rf "$T"
}

# 1. anchor: visual shows the Done popup.
visual=$(run_style visual)
if grep -q '^terminal-notifier .*Done' <<<"$visual"; then
    pass "visual style shows the Done popup"
else fail "visual style shows the Done popup" "calls=$(tr '\n' '|' <<<"$visual")"; fi

# 2. telegram makes exactly the same calls as visual.
telegram=$(run_style telegram)
if [[ "$telegram" == "$visual" ]]; then
    pass "a saved telegram style behaves exactly as visual"
else fail "a saved telegram style behaves exactly as visual" "visual=$(tr '\n' '|' <<<"$visual") telegram=$(tr '\n' '|' <<<"$telegram")"; fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
