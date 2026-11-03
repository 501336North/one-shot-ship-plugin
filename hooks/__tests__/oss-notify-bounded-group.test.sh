#!/bin/bash
# oss-notify.sh's no-timeout-tool fallback ends a bounded command's children too (T54b).
#
# @behavior Finishing an /oss command on stock macOS (no timeout tool) never leaves a hung helper's child
#           running: when a workflow-state, copy, update or chain-trigger call outlives its bound, the
#           bound ends everything it started, and never the hook itself.
# @business-rule T54b (as T54 for session start): like GNU timeout, the fallback runs the command in its own
#           process group and kills that group. Its other rules stay: `|| true` (a bounded call never
#           fails the hook), stdout passes through, and stderr goes to the caller's redirect (F6).
#
# Usage: /bin/bash hooks/__tests__/oss-notify-bounded-group.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash hooks/__tests__/oss-notify-bounded-group.test.sh  (mutants)
set -uo pipefail
# The hooks read the API key and URL from $OSS_CONFIG_DIR/config.json: a developer's exported
# override must not lead them to the real key and the real API (T19).
unset OSS_CONFIG_DIR OSS_MANIFEST_URL
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="${HOOKS_UNDER_TEST:-$ROOT/hooks}/oss-notify.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
source "$ROOT/hooks/__tests__/lib/run-capped.sh"
echo "Running oss-notify-bounded-group tests..."

T=$(mktemp -d)
# Every process these rows start records its pid in $T/pids: killed (and its group, when it leads one) even
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

# System tools without any timeout tool (stock macOS), so the hook's own fallback timer runs.
mkdir -p "$T/sys"
for d in /usr/local/bin /usr/bin /bin /usr/sbin /sbin; do
    for f in "$d"/*; do
        n=${f##*/}
        case "$n" in *timeout) continue ;; esac
        [[ -e "$T/sys/$n" ]] || ln -s "$f" "$T/sys/$n" 2>/dev/null
    done
done
[[ -z "$(ls "$T/sys" | grep 'timeout$')" ]] && pass "no timeout tool on the test PATH (anchor)" \
    || fail "no timeout tool on the test PATH (anchor)" "$(ls "$T/sys" | grep 'timeout$' | tr '\n' ' ')"

# --- run_with_timeout itself, under the hook's own `set -euo pipefail` ------------------------------------------
sed -n '/^run_with_timeout() {/,/^}/p' "$HOOK" > "$T/rwt.sh"
grep -q 'run_with_timeout()' "$T/rwt.sh" && pass "run_with_timeout is read from the hook (anchor)" \
    || fail "run_with_timeout is read from the hook (anchor)" "no run_with_timeout() in $HOOK"
# The caller: fast commands (stderr to the caller's redirect), then one that
# forks a long sleep and hangs past a 1 s bound. It waits (at most 3 s, by polling) for that sleep to go, then
# says it is still alive itself.
cat > "$T/caller.sh" <<'CALLER'
set -euo pipefail
source "$1"; D=$2
for c in 0 1 7; do
    out=$(run_with_timeout 5 sh -c 'echo "out-$1"; echo "err-$1" >&2; exit "$1"' x "$c" 2>>"$D/err.log"); echo "fast $c rc=$? out=$out"
done
run_with_timeout 1 sh -c 'echo $$ >> "$1/pids"; /bin/sleep 60 & echo $! >> "$1/pids"; echo $! > "$1/child.pid"; /bin/sleep 60' x "$D"
echo "bounded rc=$?"
c=$(cat "$D/child.pid" 2>/dev/null || true); i=0
while kill -0 "$c" 2>/dev/null && [ $i -lt 30 ]; do /bin/sleep 0.1; i=$((i + 1)); done
if [ -z "$c" ]; then echo "child never started"; elif kill -0 "$c" 2>/dev/null; then echo "child alive"; else echo "child gone"; fi
echo "caller alive, flags=$-"
CALLER
PATH="$T/sys" run_capped 20 /bin/bash "$T/caller.sh" "$T/rwt.sh" "$T" >"$T/caller.out" 2>"$T/caller.err"; rc=$?
for c in 0 1 7; do
    if grep -qx "fast $c rc=0 out=out-$c" "$T/caller.out" && grep -qx "err-$c" "$T/err.log"; then
        pass "a command that exits $c in time: its output and stderr pass through, the call never fails the hook"
    else fail "a command that exits $c in time: its output and stderr pass through, the call never fails the hook" \
        "out=$(tr '\n' '|' < "$T/caller.out") err.log=$(tr '\n' '|' < "$T/err.log" 2>/dev/null)"; fi
done
grep -qx "bounded rc=0" "$T/caller.out" && pass "a command past its bound is ended at the bound and does not fail the hook" \
    || fail "a command past its bound is ended at the bound and does not fail the hook" "rc=$rc $(tr '\n' '|' < "$T/caller.out")"
grep -qx "child gone" "$T/caller.out" && pass "the bound also ends the command's child (T54b)" \
    || fail "the bound also ends the command's child (T54b)" "$(tr '\n' '|' < "$T/caller.out")"
if [[ $rc -eq 0 ]] && grep -q "^caller alive, flags=[^m]*$" "$T/caller.out"; then
    pass "the caller survives the bound, leaves nothing in its own group and keeps its shell flags"
else fail "the caller survives the bound, leaves nothing in its own group and keeps its shell flags" \
    "run_capped rc=$rc out=$(tr '\n' '|' < "$T/caller.out") err=$(tr '\n' '|' < "$T/caller.err")"; fi

# --- End to end: `oss-notify.sh --workflow build complete` with a workflow-state call that hangs ----------------
# Its first bounded call (completeStep, 2 s) forks a child and hangs; the bound ends both. `node` and `curl` are
# exported bash functions: the hook's node calls run in a fork of the hook, nothing new is exec'd (no
# first-exec lag), and no argv names a file other checkouts' test setups pkill by name. Every other node call
# exits 0. A logged-in HOME whose loopback http URL is refused: nothing reaches a network.
mkdir -p "$T/home/.oss" "$T/proj"
printf '%s' '{"apiKey":"fake-key-not-real","apiUrl":"http://127.0.0.1:9"}' > "$T/home/.oss/config.json"
(
    node() {
        case " $* " in *" completeStep "*)
            /bin/sleep 60 & echo $! >> "$T54B_DIR/pids"; echo $! >> "$T54B_DIR/wf.pids"
            /bin/sh -c 'echo $PPID' >> "$T54B_DIR/wf.pids"; tail -1 "$T54B_DIR/wf.pids" >> "$T54B_DIR/pids"
            wait;;
        esac
        return 0
    }
    curl() { return 0; }
    export -f node curl; export T54B_DIR="$T"
    cd "$T/proj" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$ROOT" CLAUDE_PROJECT_DIR="" PATH="$T/sys" \
        run_capped 30 /bin/bash "$HOOK" --workflow build complete </dev/null >"$T/e2e.out" 2>"$T/e2e.err"
); rc=$?
left=""; i=0
while [[ $i -lt 50 ]]; do
    left=""; for p in $(cat "$T/wf.pids" 2>/dev/null); do kill -0 "$p" 2>/dev/null && left="$left $p"; done
    [[ -z "$left" ]] && break; /bin/sleep 0.1; i=$((i + 1))
done
if [[ $(grep -c . "$T/wf.pids" 2>/dev/null) -ge 2 ]] && [[ -z "$left" && $rc -eq 0 ]]; then
    pass "a hung workflow-state call on complete and its child are gone after the bound; the hook exits 0 (T54b)"
else fail "a hung workflow-state call on complete and its child are gone after the bound; the hook exits 0 (T54b)" \
    "run_capped rc=$rc started=[$(tr '\n' ' ' < "$T/wf.pids" 2>/dev/null)] alive=[${left}] err=$(tr '\n' '|' < "$T/e2e.err")"; fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
