#!/bin/bash
# oss-notify.sh --workflow <cmd> complete is bounded, quiet and keeps its debug log.
#
# @behavior Finishing a command never hangs on a stalled helper, prints only what the model needs
#           (the CHAIN block), and chain-trigger's own errors land in ~/.oss/logs/chain-trigger.log.
# @business-rule F8: each workflow-state update on complete is bounded (2s, like every other bounded
#           state call in the file). F7: the state CLI's
#           status lines ("Step completed: ...") are not printed into the model's context on complete.
#           F6: run_with_timeout keeps stderr, so a caller's 2>> redirect receives it; callers that
#           must stay quiet redirect stderr themselves.
#
# No check here measures elapsed time (T13): a new executable's first exec on macOS is scanned
# (0.3 s idle, up to 60 s under load), so a `took < N` assert flakes. Instead, boundedness is read
# from a recording timeout/gtimeout stub, and "does not hang" is proven against a state CLI that
# blocks until a release file exists, which the test never creates while it waits. The 60 s polls
# below are failure guards, never the asserted value.
#
# Time cost: about 15s idle (case 4 waits for the hook's own 6 x 2s fallback timers); stub warm-ups
# take longer under load, untimed.
#
# Usage: ./hooks/__tests__/oss-notify-complete-bounds.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy ./hooks/__tests__/oss-notify-complete-bounds.test.sh  (mutants)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
HOOK="${HOOKS_UNDER_TEST:-$ROOT/hooks}/oss-notify.sh"
BACKSTOP_TICKS=600   # 600 x 0.1 s = 60 s; reached only when a check is about to fail
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
# shellcheck source=lib/warm-stub.sh
source "$ROOT/hooks/__tests__/lib/warm-stub.sh"
echo "Running oss-notify-complete-bounds tests..."

T=""; HOOK_PID=""
cleanup() {
    [[ -n "$T" ]] || return 0
    : > "$T/release" 2>/dev/null          # let any blocked stub go, so nothing is left running
    [[ -n "$HOOK_PID" ]] && wait "$HOOK_PID" 2>/dev/null
    HOOK_PID=""
    rm -rf "$T"; T=""
}
trap cleanup EXIT

# wait_for <condition-command...>: true once the condition holds, false at the backstop.
wait_for() {
    local i
    for ((i = 0; i < BACKSTOP_TICKS; i++)); do "$@" && return 0; /bin/sleep 0.1; done
    "$@"
}
alive() { kill -0 "$1" 2>/dev/null; }
gone() { ! kill -0 "$1" 2>/dev/null; }
timers_gone() {   # every fallback-timer sleep recorded in $T/sleep.pids has exited
    local p
    while read -r p; do alive "$p" && return 1; done < <(cat "$T/sleep.pids" 2>/dev/null)
    return 0
}

# Sandbox: temp HOME and a fake plugin root. The fake `node` acts as each CLI, per $STATE:
#   STATE unset: the state CLI answers at once and prints status lines on stdout and stderr.
#   STATE=hang:  the state CLI records that it was called, then blocks until $T/release exists
#                (or the sandbox is gone, so a stub orphaned by a failing mutant still exits).
# Every node call is logged as "<timeout limit it ran under, or none>|<argv>" in node.calls.
sandbox() {
    T=$(cd "$(mktemp -d)" && pwd -P)
    mkdir -p "$T/home/.oss" "$T/plugin/hooks" "$T/plugin/watcher/dist/cli" "$T/bin"
    warm_stub "$T/plugin/hooks/oss-log.sh" 'exit 0' || fail "sandbox" "oss-log.sh stub did not warm"
    warm_stub "$T/bin/node" "$(cat <<EOF
echo "\${OSS_TEST_UNDER_TIMEOUT:-none}|\$*" >> "$T/node.calls"
case "\$1" in
  *update-workflow-state.js)
    if [[ "\${STATE:-}" == hang ]]; then
        echo "\$*" >> "$T/received"
        while [[ -d "$T" && ! -e "$T/release" ]]; do /bin/sleep 0.05; done
        exit 0
    fi
    echo "STATE-STDOUT \$*"; echo "STATE-STDERR \$*" >&2 ;;
  *chain-trigger.cjs)
    echo "---CHAIN_COMMANDS---"; echo "CHAIN: /oss:review (always)"; echo "---END_CHAIN_COMMANDS---"
    echo "No API key configured. Run /oss:login" >&2; exit 1 ;;
esac
exit 0
EOF
)" || fail "sandbox" "node stub did not warm"
    : > "$T/plugin/watcher/dist/cli/update-workflow-state.js"
    : > "$T/plugin/watcher/dist/cli/chain-trigger.cjs"
}
# Recording timeout and gtimeout (the hook takes gtimeout first, then timeout): each logs its argv,
# tells the command which limit it runs under, and execs it. They shadow any real tool on the PATH.
recording_timeouts() {
    local name
    for name in gtimeout timeout; do
        warm_stub "$T/bin/$name" "$(cat <<EOF
echo "$name \$*" >> "$T/timeout.calls"
export OSS_TEST_UNDER_TIMEOUT="\$1"; shift
exec "\$@"
EOF
)" || fail "sandbox" "$name stub did not warm"
    done
}
# A PATH of system tools with neither timeout nor gtimeout (stock macOS): the hook's own timer runs.
no_timeout_tools() {
    local d f n
    mkdir -p "$T/sys"
    for d in /usr/local/bin /usr/bin /bin /usr/sbin /sbin; do
        for f in "$d"/*; do
            n=${f##*/}
            [[ "$n" == timeout || "$n" == gtimeout || -e "$T/sys/$n" ]] && continue
            ln -s "$f" "$T/sys/$n" 2>/dev/null
        done
    done
}
run_notify() {
    (cd "$T" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="" PATH="$T/bin:$PATH" \
        OSS_TEST_UNDER_TIMEOUT="" "$SH" "$HOOK" "$@" </dev/null >"$T/out" 2>"$T/err")
}
state_calls() { grep "update-workflow-state.js" "$T/node.calls" 2>/dev/null; }

# 1. F8: finishing /oss:ship makes six workflow-state updates; every one runs under a 2s timeout,
#    so a stalled state CLI can delay the user's next prompt by at most the bound.
sandbox
recording_timeouts
run_notify --workflow ship complete
calls=$(state_calls)
n_calls=$(printf '%s' "$calls" | grep -c . )
n_bounded=$(printf '%s' "$calls" | grep -c '^2|')
if [[ $n_calls -eq 6 && $n_bounded -eq 6 ]]; then
    pass "every workflow-state update on ship complete runs under a 2s timeout"
else fail "every workflow-state update on ship complete runs under a 2s timeout" \
    "calls=$n_calls bounded=$n_bounded node=$(tr '\n' '|' < "$T/node.calls" 2>/dev/null) timeout=$(tr '\n' '|' < "$T/timeout.calls" 2>/dev/null)"; fi

# 1b. Same rule for a mid-chain command (build sets nextCommand=ship instead of completing the chain).
cleanup; sandbox
recording_timeouts
run_notify --workflow build complete
calls=$(state_calls)
n_calls=$(printf '%s' "$calls" | grep -c . )
n_bounded=$(printf '%s' "$calls" | grep -c '^2|')
if [[ $n_calls -eq 5 && $n_bounded -eq 5 ]] && printf '%s' "$calls" | grep -q '^2|.*setNextCommand ship$'; then
    pass "every workflow-state update on build complete runs under a 2s timeout"
else fail "every workflow-state update on build complete runs under a 2s timeout" \
    "calls=$n_calls bounded=$n_bounded node=$(tr '\n' '|' < "$T/node.calls" 2>/dev/null)"; fi

# 2. F6: when the chain step fails, the user can read why in chain-trigger.log, not in the model's context.
if grep -q "No API key configured" "$T/home/.oss/logs/chain-trigger.log" 2>/dev/null; then
    pass "chain-trigger stderr lands in ~/.oss/logs/chain-trigger.log"
else fail "chain-trigger stderr lands in ~/.oss/logs/chain-trigger.log" "log=$(cat "$T/home/.oss/logs/chain-trigger.log" 2>/dev/null)"; fi

# 3. F7: on complete the model sees only the CHAIN block it must act on, no workflow-state chatter.
if grep -q "^CHAIN: /oss:review (always)$" "$T/out" && ! grep -q "STATE-" "$T/out" "$T/err"; then
    pass "complete prints the CHAIN block and no workflow-state status lines"
else fail "complete prints the CHAIN block and no workflow-state status lines" "out=$(tr '\n' '|' < "$T/out") err=$(tr '\n' '|' < "$T/err")"; fi
cleanup

# 4. F8: a state CLI that never answers cannot hold complete open. Every one of ship's six updates
#    blocks until released; the hook must exit without the release (the event-driven proof that a
#    hung call was cut off), and must have attempted all six updates on the way.
#    The hook's own fallback timer `sleep` is gated: timer N first waits until $T/received has N
#    lines, then sleeps for real. Calls are sequential and call N starts before timer N, so the kill
#    for call N can never land before call N has recorded itself: the count below cannot race the
#    timer, however slow a stub is to start.
sandbox
no_timeout_tools
warm_stub "$T/bin/sleep" "$(cat <<EOF
echo x >> "$T/timer.calls"; n=\$(grep -c . "$T/timer.calls")
while [[ -d "$T" && ! -e "$T/release" ]] && (( \$(cat "$T/received" 2>/dev/null | grep -c .) < n )); do /bin/sleep 0.05; done
exec /bin/sleep "\$@"
EOF
)" || fail "sandbox" "gated sleep stub did not warm"
(cd "$T" && STATE=hang HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="" PATH="$T/bin:$T/sys" \
    OSS_TEST_UNDER_TIMEOUT="" "$SH" "$HOOK" --workflow ship complete </dev/null >"$T/out" 2>"$T/err") &
HOOK_PID=$!
if ! wait_for test -s "$T/received"; then
    fail "a hung workflow-state CLI does not hold ship complete open" "the state CLI was never called"
elif wait_for gone "$HOOK_PID" && [[ ! -e "$T/release" ]]; then
    pass "a hung workflow-state CLI does not hold ship complete open"
else fail "a hung workflow-state CLI does not hold ship complete open" \
    "hook still running at the 60s backstop after $(grep -c . "$T/received") update(s): $(tr '\n' '|' < "$T/received")"; fi
n_recv=$(grep -c . "$T/received" 2>/dev/null)
if [[ $n_recv -eq 6 ]]; then
    pass "with every update hung, ship complete still attempts all 6 workflow-state updates"
else fail "with every update hung, ship complete still attempts all 6 workflow-state updates" \
    "reached $n_recv of 6: $(tr '\n' '|' < "$T/received" 2>/dev/null)"; fi
cleanup

# 5. F6 control: session events update state too, and keep the state CLI's stderr out of the user's view.
sandbox
recording_timeouts
run_notify --session context_saved
if grep -q "^2|.*setSupervisor idle" "$T/node.calls" && ! grep -q "STATE-STDERR" "$T/err"; then
    pass "session state updates keep the state CLI's stderr out of the hook's output"
else fail "session state updates keep the state CLI's stderr out of the hook's output" "node=$(tr '\n' '|' < "$T/node.calls" 2>/dev/null) err=$(tr '\n' '|' < "$T/err")"; fi
cleanup

# 6. R2-1: on a host with neither timeout nor gtimeout (stock macOS), the hook's fallback timer must not
#    hold the hook's stdout open, print a job notice, or leave its sleep behind. The timer's `sleep` here
#    blocks until release, so a timer that held stdout or outlived the hook would never finish on its own.
sandbox
no_timeout_tools
warm_stub "$T/bin/sleep" "$(cat <<EOF
echo \$\$ >> "$T/sleep.pids"
while [[ -d "$T" && ! -e "$T/release" ]]; do /bin/sleep 0.05; done
EOF
)" || fail "sandbox" "sleep stub did not warm"
if PATH="$T/bin:$T/sys" command -v timeout >/dev/null || PATH="$T/bin:$T/sys" command -v gtimeout >/dev/null; then
    fail "fallback timer setup hides timeout and gtimeout" "a timeout tool is still on the PATH"
else
    (cd "$T" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="" PATH="$T/bin:$T/sys" \
        OSS_TEST_UNDER_TIMEOUT="" "$SH" "$HOOK" --workflow audit complete '{}' </dev/null 2>"$T/err" | cat >"$T/out") &
    HOOK_PID=$!
    released=yes; wait_for gone "$HOOK_PID" || released=no
    [[ -e "$T/release" ]] && released=no
    left=""
    if [[ $released == yes ]]; then
        wait_for timers_gone
        while read -r p; do alive "$p" && left="$left $p"; done < <(cat "$T/sleep.pids" 2>/dev/null)
    fi
    if [[ $released == yes ]] && ! grep -q "Terminated" "$T/err" && [[ -z "$left" ]]; then
        pass "the fallback timer releases stdout at once, prints no job notice, leaves no sleep"
    else fail "the fallback timer releases stdout at once, prints no job notice, leaves no sleep" \
        "stdout-released=$released timers=$(grep -c . "$T/sleep.pids" 2>/dev/null) leftover-sleeps=[${left}] err=$(tr '\n' '|' < "$T/err")"; fi
fi
cleanup

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
