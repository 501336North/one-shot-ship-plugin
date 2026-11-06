#!/bin/bash
# The no-timeout-tool fallback leaves nothing running: nothing that keeps its time limit (a timer, a supervisor)
# outlives a call that ends in time, and a bound that fires while the command is forking ends every child (T54c, T72).
#
# @behavior Session start and every /oss command's notify step make many short bounded calls on stock macOS
#           (no timeout tool). None of them leaves anything running after the call returns.
# @business-rule R2-1 / T54c: cancelling the timer always ends its sleep too, with no window: the old timer
#           could be cancelled between starting its sleep and recording the sleep's pid, so the sleep lived
#           on until the bound (up to 30 s for chain-trigger). Applies to hooks/oss-session-start.sh run_bounded
#           and hooks/oss-notify.sh run_with_timeout. T72 replaced the timer with one supervisor per bound (the
#           command's parent); the same rule holds for it.
# @behavior A bounded command that is starting children when its bound fires leaves none of them running.
# @business-rule T54c: on macOS a group kill can miss a child that is being forked as it lands; once the bound has
#           fired (the command ended by SIGKILL, 137) the group is killed once more.
#
# How: each bounded command records its parent (the hook itself, or a supervisor), and a `sleep` wrapper first on
# PATH records each timer sleep and its parent. CALLS instant calls per hook (the shape that loses the race most
# often) run under run_capped; then, after a bounded poll, every recorded process but the hook must be gone. Then FORK_RUNS bounded commands per hook fork 5 s sleeps in a loop (at most 400) until a 0.1 s
# bound fires; after each, nothing may be left in the command's process group.
#
# Usage: /bin/bash hooks/__tests__/bounded-timer-cancel.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash hooks/__tests__/bounded-timer-cancel.test.sh  (mutants)
set -uo pipefail
# The hooks read the API key and URL from $OSS_CONFIG_DIR/config.json: a developer's exported
# override must not lead them to the real key and the real API (T19).
unset OSS_CONFIG_DIR OSS_MANIFEST_URL
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS="${HOOKS_UNDER_TEST:-$ROOT/hooks}"
CALLS=300
FORK_RUNS=50
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
source "$ROOT/hooks/__tests__/lib/run-capped.sh"
source "$ROOT/hooks/__tests__/lib/warm-stub.sh"
echo "Running bounded-timer-cancel tests..."

T=$(mktemp -d)
# Every recorded sleep is killed (and its group, when it leads one) even when a row fails.
reap() {
    local p
    for p in $(cat "$T"/*.pids 2>/dev/null); do
        [[ "$(ps -o pgid= -p "$p" 2>/dev/null | tr -d ' ')" == "$p" ]] && kill -9 -- "-$p" 2>/dev/null
        kill -9 "$p" 2>/dev/null
    done
    # the mid-fork rows' command groups (their leaders are gone, so by group id while it still has members)
    for p in $(cat "$T"/*.leaders 2>/dev/null); do
        ps -A -o pgid= | awk -v g="$p" '$1 == g { f = 1 } END { exit !f }' && kill -9 -- "-$p" 2>/dev/null
    done
    rm -rf "${T:?}"
}
trap reap EXIT

# System tools without any timeout tool (stock macOS), so each hook's own fallback timer runs.
mkdir -p "$T/sys"
for d in /usr/local/bin /usr/bin /bin /usr/sbin /sbin; do
    for f in "$d"/*; do
        n=${f##*/}
        case "$n" in *timeout | sleep) continue ;; esac
        [[ -e "$T/sys/$n" ]] || ln -s "$f" "$T/sys/$n" 2>/dev/null
    done
done
[[ -z "$(ls "$T/sys" | grep 'timeout$')" ]] && pass "no timeout tool on the test PATH (anchor)" \
    || fail "no timeout tool on the test PATH (anchor)" "$(ls "$T/sys" | grep 'timeout$' | tr '\n' ' ')"
# A timer's `sleep`: records its pid and its parent's in $SLEEP_PIDS, then becomes the real sleep (same pid).
# Warmed, so the macOS first-exec scan happens here.
warm_stub "$T/bin/sleep" 'echo "$$ $PPID" >> "$SLEEP_PIDS"; exec /bin/sleep "$@"' || fail "sleep wrapper warms up" "it did not run"

# The driver: under the hook's own shell options, one slow call, then CALLS instant calls, each command recording
# its parent; then waits (at most 3 s, by polling) for every recorded process other than itself to go.
cat > "$T/driver.sh" <<'DRIVER'
fn=$1; src=$2; calls=$3; D=$4; [[ $5 == strict ]] && set -euo pipefail
source "$src"
rec='echo $PPID >> "$1"'
SLEEP_PIDS="$D/$fn.pids" "$fn" 30 /bin/sh -c "$rec; /bin/sleep 0.3" x "$D/$fn.parents"; echo "anchor rc=$?"
ok=0
for ((i = 0; i < calls; i++)); do
    SLEEP_PIDS="$D/$fn.pids" "$fn" 30 /bin/sh -c "$rec" x "$D/$fn.parents" && ok=$((ok + 1))
done
echo "calls ok=$ok"
left=""
for ((i = 0; i < 30; i++)); do
    left=""; for p in $(cat "$D/$fn.parents" "$D/$fn.pids" 2>/dev/null); do [[ $p != "$$" ]] && kill -0 "$p" 2>/dev/null && left="$left $p"; done
    [[ -z "$left" ]] && break; /bin/sleep 0.1
done
echo "recorded=$(grep -c . "$D/$fn.parents" 2>/dev/null) lingering=[${left# }]"
DRIVER

# check <label> <hook file> <function> <shell options: strict|plain>
check() {
    sed -n "/^$3() {/,/^}/p" "$2" > "$T/$3.sh"
    if ! grep -q "$3()" "$T/$3.sh"; then fail "$1: $3 is read from the hook (anchor)" "no $3() in $2"; return; fi
    PATH="$T/bin:$T/sys" run_capped 120 /bin/bash "$T/driver.sh" "$3" "$T/$3.sh" "$CALLS" "$T" "$4" \
        >"$T/$3.out" 2>"$T/$3.err"; local rc=$?
    local out; out="rc=$rc $(tr '\n' '|' < "$T/$3.out") err=$(head -3 "$T/$3.err" | tr '\n' '|')"
    grep -q '^anchor rc=0$' "$T/$3.out" && grep -q "^recorded=$((CALLS + 1)) " "$T/$3.out" \
        && pass "$1: every bounded command ran and recorded its parent (anchor)" \
        || fail "$1: every bounded command ran and recorded its parent (anchor)" "$out"
    grep -qx "calls ok=$CALLS" "$T/$3.out" && pass "$1: $CALLS instant calls all return 0" \
        || fail "$1: $CALLS instant calls all return 0" "$out"
    if [[ $rc -eq 0 ]] && grep -q '^recorded=[0-9]* lingering=\[\]$' "$T/$3.out"; then
        pass "$1: no timer or supervisor outlives its call ($CALLS instant calls; T54c, T72)"
    else fail "$1: no timer or supervisor outlives its call ($CALLS instant calls; T54c, T72)" "$out"; fi
    # Ending a call prints no job notice ("Terminated") into the hook's stderr.
    grep -qE 'Terminated|Killed' "$T/$3.err" && fail "$1: ending a bounded call prints no job notice" "$out" \
        || pass "$1: ending a bounded call prints no job notice"
}
check "session start" "$HOOKS/oss-session-start.sh" run_bounded plain
check "oss-notify" "$HOOKS/oss-notify.sh" run_with_timeout strict

# --- A bound that fires mid-fork ---------------------------------------------------------------------------------
# The midfork driver: FORK_RUNS times, a command that records its pid (its group id) and forks 5 s sleeps (at most
# 400) is bounded at 0.1 s; then it waits (at most 2 s, by polling) for that group to empty, and stops at
# the first run where it did not.
cat > "$T/midfork.sh" <<'MIDFORK'
fn=$1; src=$2; runs=$3; D=$4; [[ $5 == strict ]] && set -euo pipefail
source "$src"
hit=0; left=0
for ((r = 0; r < runs; r++)); do
    "$fn" 0.1 /bin/bash -c 'echo $$ >> "$1"; for ((i = 0; i < 400; i++)); do /bin/sleep 5 & done; wait' x "$D/$fn.leaders" 2>/dev/null || true
    g=$(tail -1 "$D/$fn.leaders"); n=0
    for ((i = 0; i < 20; i++)); do
        n=$(ps -A -o pgid= | awk -v g="$g" '$1 == g' | wc -l | tr -d ' ')
        [[ $n -eq 0 ]] && break; /bin/sleep 0.1
    done
    if [[ $n -gt 0 ]]; then hit=$((hit + 1)); left=$((left + n)); kill -9 -- "-$g" 2>/dev/null || true; break; fi   # one is enough
done
echo "runs=$runs started=$(grep -c . "$D/$fn.leaders") runs-with-survivors=$hit survivors=$left"
MIDFORK
# midfork <label> <hook file> <function> <shell options>
midfork() {
    SLEEP_PIDS="$T/$3.midfork.pids" PATH="$T/bin:$T/sys" run_capped 240 /bin/bash "$T/midfork.sh" "$3" "$T/$3.sh" "$FORK_RUNS" "$T" "$4" \
        >"$T/$3.midfork.out" 2>&1; local rc=$?
    if [[ $rc -eq 0 ]] && grep -qx "runs=$FORK_RUNS started=$FORK_RUNS runs-with-survivors=0 survivors=0" "$T/$3.midfork.out"; then
        pass "$1: a bound that fires mid-fork leaves no child running ($FORK_RUNS runs; T54c)"
    else fail "$1: a bound that fires mid-fork leaves no child running ($FORK_RUNS runs; T54c)" \
        "rc=$rc $(head -3 "$T/$3.midfork.out" | cut -c1-200 | tr '\n' '|')"; fi
}
midfork "session start" "$HOOKS/oss-session-start.sh" run_bounded plain
midfork "oss-notify" "$HOOKS/oss-notify.sh" run_with_timeout strict

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
