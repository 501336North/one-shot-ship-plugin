#!/bin/bash
# oss-stop.sh: a saved notification style of `telegram` behaves exactly as `visual`.
#
# @behavior A user whose settings still say style "telegram" (the retired Telegram bot) gets the same
#           "Done" popup when Claude finishes as a visual user does.
# @business-rule The Telegram style is gone; an old saved value reads as `visual`, nothing else.
#
# Usage: ./hooks/__tests__/oss-stop-telegram-style.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy ./hooks/__tests__/oss-stop-telegram-style.test.sh   (mutants)
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
HOOK="${HOOKS_UNDER_TEST:-$ROOT/hooks}/oss-stop.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
source "$ROOT/hooks/__tests__/lib/warm-stub.sh"
echo "Running oss-stop-telegram-style tests..."

# Stubs made and warmed once (macOS scans each new executable on its first exec, 0.3-60 s): fake
# terminal-notifier / osascript / say / afplay that record their calls into the current case's dir, $SHIM.
KS=$(mktemp -d); KS=$(cd "$KS" && pwd -P)
trap 'rm -rf "$KS"' EXIT
STUBS_WARM=y
for b in terminal-notifier osascript say afplay; do
    warm_stub "$KS/bin/$b" "echo \"$b \$*\" >> \"\$SHIM/calls\"" || STUBS_WARM=n
done
if [[ $STUBS_WARM != y ]]; then echo "✗ FAIL: stub warm-up — a stub did not run"; exit 1; fi
# Sandbox: temp HOME with settings.json; $T/bin is the stub dir. The hook backgrounds say and afplay
# (`&>/dev/null &` redirects only fds 1 and 2), so they inherit fd 3: with `3>&1` inside the
# substitution, $(...) returns only when every job the hook started has exited. The calls are read
# after that - no polling, no sleeps - so a late call is counted and a missing one is really missing.
run_style() {
    local style="$1" T _wait
    T=$(mktemp -d)
    mkdir -p "$T/home/.oss"
    ln -s "$KS/bin" "$T/bin"
    printf '{"notifications":{"style":"%s"}}\n' "$style" > "$T/home/.oss/settings.json"
    _wait=$(cd "$T" && SHIM="$T" HOME="$T/home" PATH="$T/bin:$PATH" "$SH" "$HOOK" 3>&1 </dev/null >/dev/null 2>&1)
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
