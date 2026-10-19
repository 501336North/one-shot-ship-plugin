#!/bin/bash
# Session start on a host with neither timeout nor gtimeout (stock macOS) leaves nothing behind.
#
# @behavior Starting a session never prints a "Terminated" job notice and never leaves the fallback
#           timer's sleep running (a live sleep holds Claude Code's hook pipe open until it expires).
# @business-rule R2-1: the run_with_timeout fallback kills its own timer, sleep included, and the
#           timer holds no stdio. Same shape as hooks/oss-notify.sh run_with_timeout.
#
# Usage: ./hooks/__tests__/session-start-timeout-fallback.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

T=$(mktemp -d)
mkdir -p "$T/home" "$T/bin" "$T/sys"
for d in /usr/local/bin /usr/bin /bin /usr/sbin /sbin; do
    for f in "$d"/*; do
        n=${f##*/}
        [[ "$n" == timeout || "$n" == gtimeout || -e "$T/sys/$n" ]] && continue
        ln -s "$f" "$T/sys/$n" 2>/dev/null
    done
done
printf '#!/bin/bash\necho $$ >> "%s/sleep.pids"\nexec %s "$@"\n' "$T" "$(command -v sleep)" > "$T/bin/sleep"
chmod +x "$T/bin/sleep"
"$T/bin/sleep" 0; rm -f "$T/sleep.pids"  # warm the wrapper so its pid is recorded promptly

if PATH="$T/bin:$T/sys" command -v timeout >/dev/null || PATH="$T/bin:$T/sys" command -v gtimeout >/dev/null; then
    fail "fallback timer setup hides timeout and gtimeout" "a timeout tool is still on the PATH"
else
    (cd "$T" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$ROOT" CLAUDE_PROJECT_DIR="" PATH="$T/bin:$T/sys" \
        bash "$ROOT/hooks/oss-session-start.sh" </dev/null >"$T/out" 2>"$T/err")
    /bin/sleep 1  # a new script's first exec can lag on macOS; every timer sleeps 2s, so an orphan is still alive
    left=""
    while read -r p; do kill -0 "$p" 2>/dev/null && left="$left $p"; done < <(cat "$T/sleep.pids" 2>/dev/null)
    if ! grep -q "Terminated" "$T/err" && [[ -z "$left" ]]; then
        pass "session start's fallback timer prints no job notice and leaves no sleep"
    else fail "session start's fallback timer prints no job notice and leaves no sleep" \
        "leftover-sleeps=[${left}] err=$(grep Terminated "$T/err" | tr '\n' '|')"; fi
    for p in $left; do kill "$p" 2>/dev/null; done
fi
rm -rf "$T"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
