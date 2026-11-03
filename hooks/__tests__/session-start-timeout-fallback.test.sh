#!/bin/bash
# Session start on a host with neither timeout nor gtimeout (stock macOS) leaves nothing behind.
#
# @behavior Starting a session never prints a "Terminated" job notice and never leaves the fallback
#           timer's sleep running (a live sleep holds Claude Code's hook pipe open until it expires).
# @business-rule R2-1: the run_with_timeout fallback kills its own timer, sleep included, and the
#           timer holds no stdio. Same shape as hooks/oss-notify.sh run_with_timeout.
# @behavior A command that outlives its bound (the opt-in health check: node, then npm test and its workers)
#           leaves nothing behind: the bound ends its children too, and never the caller.
# @business-rule T54: like GNU timeout, the fallback runs the command in its own process group and kills that
#           group; a fast command's output and exit status pass through unchanged.
#
# Usage: ./hooks/__tests__/session-start-timeout-fallback.test.sh
set -uo pipefail
# The hooks read the API key and URL from $OSS_CONFIG_DIR/config.json: a developer's exported
# override must not lead them to the real key and the real API (T19).
unset OSS_CONFIG_DIR OSS_MANIFEST_URL
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

# Session start runs under an alias (lib/session-start-alias.sh): an outside `pkill -f oss-session-start` misses it (T48).
source "$ROOT/hooks/__tests__/lib/session-start-alias.sh"
source "$ROOT/hooks/__tests__/lib/run-capped.sh"
T=$(mktemp -d)
# Every process the T54 rows start records its pid in $T/pids: killed (and its group, when it leads one) even
# when a row fails, so a regression leaves no 60 s sleeps behind.
reap() {
    local p
    for p in $(cat "$T/pids" 2>/dev/null); do
        [[ "$(ps -o pgid= -p "$p" 2>/dev/null | tr -d ' ')" == "$p" ]] && kill -9 -- "-$p" 2>/dev/null
        kill -9 "$p" 2>/dev/null
    done
    rm -rf "${T:?}"
}
trap reap EXIT
mkdir -p "$T/home" "$T/bin" "$T/sys"
# No hook logging here (an empty, non-executable oss-log.sh is skipped): its argv names "oss-session-start",
# so an outside pkill ends it and the hook prints a "Terminated" notice that is not the timer's.
mkdir -p "$T/ss-alias/hooks"; : > "$T/ss-alias/hooks/oss-log.sh"
SS_HOOK=$(session_start_alias "$ROOT/hooks" "$T/ss-alias/hooks") || { echo "✗ FAIL: session start alias"; exit 1; }
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
        bash "$SS_HOOK" </dev/null >"$T/out" 2>"$T/err"); rc=$?
    /bin/sleep 1  # a new script's first exec can lag on macOS; every timer sleeps 2s, so an orphan is still alive
    left=""
    while read -r p; do kill -0 "$p" 2>/dev/null && left="$left $p"; done < <(cat "$T/sleep.pids" 2>/dev/null)
    # rc 0: the hook ran to the end (a hook killed at its start leaves no sleep either).
    if [[ $rc -eq 0 ]] && ! grep -q "Terminated" "$T/err" && [[ -z "$left" ]]; then
        pass "session start's fallback timer prints no job notice and leaves no sleep (hook exit 0)"
    else fail "session start's fallback timer prints no job notice and leaves no sleep" \
        "rc=$rc leftover-sleeps=[${left}] err=$(grep Terminated "$T/err" | tr '\n' '|')"; fi
    for p in $left; do kill "$p" 2>/dev/null; done

    # --- T54: the fallback's bound ends the command's children, never its caller --------------------------------
    sed -n '/^run_bounded() {/,/^}/p' "$ROOT/hooks/oss-session-start.sh" > "$T/run-bounded.sh"
    grep -q 'run_bounded()' "$T/run-bounded.sh" && pass "run_bounded is read from the hook (anchor)" \
        || fail "run_bounded is read from the hook (anchor)" "no run_bounded() in hooks/oss-session-start.sh"
    # The caller: fast commands, then one that forks a long sleep and hangs
    # past a 1 s bound. It waits (at most 3 s, by polling) for that sleep to go, then says it is still alive itself.
    cat > "$T/caller.sh" <<'CALLER'
source "$1"; D=$2
for c in 0 1 7; do out=$(run_bounded 5 sh -c 'echo "out-$1"; exit "$1"' x "$c"); echo "fast $c rc=$? out=$out"; done
run_bounded 1 sh -c 'echo $$ >> "$1/pids"; /bin/sleep 60 & echo $! >> "$1/pids"; echo $! > "$1/child.pid"; /bin/sleep 60' x "$D"
echo "bounded rc=$?"
c=$(cat "$D/child.pid" 2>/dev/null); i=0
while kill -0 "$c" 2>/dev/null && [ $i -lt 30 ]; do /bin/sleep 0.1; i=$((i + 1)); done
if [ -z "$c" ]; then echo "child never started"; elif kill -0 "$c" 2>/dev/null; then echo "child alive"; else echo "child gone"; fi
echo "caller alive, flags=$-"
CALLER
    PATH="$T/sys" run_capped 20 /bin/bash "$T/caller.sh" "$T/run-bounded.sh" "$T" >"$T/caller.out" 2>"$T/caller.err"; rc=$?
    for c in 0 1 7; do
        grep -qx "fast $c rc=$c out=out-$c" "$T/caller.out" && pass "a command that ends in time keeps its exit status $c and its output" \
            || fail "a command that ends in time keeps its exit status $c and its output" "$(tr '\n' '|' < "$T/caller.out")"
    done
    grep -qx "bounded rc=137" "$T/caller.out" && pass "a command past its bound is ended at the bound (137)" \
        || fail "a command past its bound is ended at the bound (137)" "rc=$rc $(tr '\n' '|' < "$T/caller.out")"
    grep -qx "child gone" "$T/caller.out" && pass "the bound also ends the command's child (T54)" \
        || fail "the bound also ends the command's child (T54)" "$(tr '\n' '|' < "$T/caller.out")"
    if [[ $rc -eq 0 ]] && grep -q "^caller alive, flags=[^m]*$" "$T/caller.out"; then
        pass "the caller survives the bound, leaves nothing in its own group and keeps its shell flags"
    else fail "the caller survives the bound, leaves nothing in its own group and keeps its shell flags" \
        "run_capped rc=$rc out=$(tr '\n' '|' < "$T/caller.out") err=$(tr '\n' '|' < "$T/caller.err")"; fi

    # End to end: the opt-in health check (OSS_RUN_HEALTH_CHECK=1) hangs after forking a child; a 1 s bound
    # ends both. `node` and `curl` are exported bash functions: the hook's node calls run in a fork of the
    # hook itself, whose argv does not name health-check.js (other checkouts' vitest setups run
    # `pkill -f health-check.js` machine-wide), and nothing new is exec'd (no first-exec lag). Every other
    # node call exits 0. A logged-in HOME whose loopback http URL is refused: nothing reaches a network.
    mkdir -p "$T/proj" "$T/hc-home/.oss"; echo '{}' > "$T/proj/package.json"
    printf '%s' '{"apiKey":"fake-key-not-real","apiUrl":"http://127.0.0.1:9"}' > "$T/hc-home/.oss/config.json"
    (
        node() {
            case "$1" in *health-check.js)
                /bin/sleep 60 & echo $! >> "$T54_DIR/pids"; echo $! >> "$T54_DIR/hc.pids"
                /bin/sh -c 'echo $PPID' >> "$T54_DIR/hc.pids"; tail -1 "$T54_DIR/hc.pids" >> "$T54_DIR/pids"
                wait;;
            esac
            return 0
        }
        curl() { return 0; }
        export -f node curl; export T54_DIR="$T"
        cd "$T/proj" && HOME="$T/hc-home" CLAUDE_PLUGIN_ROOT="$ROOT" CLAUDE_PROJECT_DIR="" PATH="$T/sys" \
            OSS_SKIP_HEALTH_CHECK=1 OSS_RUN_HEALTH_CHECK=1 OSS_HEALTH_CHECK_TIMEOUT=1 run_capped 30 /bin/bash "$SS_HOOK" </dev/null >/dev/null 2>"$T/hc.err"
    ); rc=$?
    i=0; while [[ ! -s "$T/hc.pids" || $(wc -l < "$T/hc.pids") -lt 2 ]] && [[ $i -lt 50 ]]; do /bin/sleep 0.1; i=$((i + 1)); done
    left=""; i=0
    while [[ $i -lt 50 ]]; do
        left=""; for p in $(cat "$T/hc.pids" 2>/dev/null); do kill -0 "$p" 2>/dev/null && left="$left $p"; done
        [[ -z "$left" ]] && break; /bin/sleep 0.1; i=$((i + 1))
    done
    if [[ $(wc -l < "$T/hc.pids" 2>/dev/null) -ge 2 ]] && [[ -z "$left" && $rc -eq 0 ]]; then
        pass "a hung health check and its child are gone after OSS_HEALTH_CHECK_TIMEOUT (T54)"
    else fail "a hung health check and its child are gone after OSS_HEALTH_CHECK_TIMEOUT (T54)" \
        "run_capped rc=$rc started=[$(tr '\n' ' ' < "$T/hc.pids" 2>/dev/null)] alive=[${left}] err=$(tr '\n' '|' < "$T/hc.err")"; fi
fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
