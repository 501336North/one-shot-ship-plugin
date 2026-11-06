#!/bin/bash
# A hook killed in the middle of a bounded call leaves nothing behind: not the command, not its children, and
# nothing that could signal a process group later (T72).
#
# @behavior Claude Code (or the user) can kill a hook at any moment: its whole process group, or the hook alone
#           with TERM or HUP. On stock macOS (no timeout tool) a bounded call in flight then ends with the hook:
#           the bounded command and its children are gone at once, and no timer or supervisor is left running.
# @business-rule T72 (security S1 MEDIUM, S2 LOW, pen-test L1 LOW): the old fallback's timer ran in its own
#           process group, outlived a killed hook and, at the bound, SIGKILLed the command's old group id, which
#           by then may belong to an unrelated process of the user. One supervisor now owns each time limit, only
#           signals the group of a command it has not reaped yet, and dies with the hook, ending that group.
#           Applies to hooks/oss-session-start.sh run_bounded and hooks/oss-notify.sh run_with_timeout.
#
# How: a driver stands in for the hook (the function read from the hook, under the hook's shell options) and makes
# one 3 s bounded call of a command that forks a 60 s sleep and then becomes a 60 s sleep. Once both run, the test
# kills the driver: its group with KILL, its group with TERM, the driver alone with TERM, the driver alone with HUP.
# Within 2 s nothing of the call may be left: not the command or its child, not the command's parent when that is
# not the hook (a supervisor), not any `sleep` it ran through PATH (a timer: a wrapper records it and its parent),
# and no member of any of their process groups.
#
# @behavior The time limit never signals a process group after it has reaped that group's leader (from then on the
#           id may belong to an unrelated process of the user), whether the call ended in time, at its bound or
#           with the hook.
# @business-rule T72 follow-up: every group kill happens while the leader is unreaped (a zombie leader keeps the id
#           reserved); the reap comes last. Proven from outside (T81: the hook reads no test variable): PERL5OPT
#           loads a test-only perl module into the supervisor that appends "kill" to $OSS_BOUND_OBSERVER_LOG before
#           each kill of a process group and "reap" after each wait that reaps the leader. run_capped's own perl
#           never gets it (it is set inside run_capped's command).
#
# Usage: /bin/bash hooks/__tests__/bounded-hook-killed.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash hooks/__tests__/bounded-hook-killed.test.sh  (mutants)
set -uo pipefail
# The hooks read the API key and URL from $OSS_CONFIG_DIR/config.json: a developer's exported
# override must not lead them to the real key and the real API (T19).
unset OSS_CONFIG_DIR OSS_MANIFEST_URL
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS="${HOOKS_UNDER_TEST:-$ROOT/hooks}"
BOUND=3
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
source "$ROOT/hooks/__tests__/lib/run-capped.sh"
source "$ROOT/hooks/__tests__/lib/warm-stub.sh"
echo "Running bounded-hook-killed tests..."

T=$(mktemp -d)
# left_of <dir>: the live processes left of that scenario's call: each recorded pid other than the hook, and every
# member of a group one of them leads.
left_of() {
    local D=$1 hook p ids=""
    hook=$(cat "$D/hook.pid" 2>/dev/null)
    for p in $(cat "$D/leader.pid" "$D/child.pid" "$D/super.pid" "$D/sleep.pids" 2>/dev/null); do
        [[ "$p" != "$hook" ]] && ids="$ids $p"
    done
    [[ -z "$ids" ]] && return 0
    ps -A -o pid=,pgid= | awk -v ids="$ids" 'BEGIN { n = split(ids, a, " "); for (i = 1; i <= n; i++) k[a[i]] = 1 }
        ($1 in k) || ($2 in k) { print $1 }' | sort -u | tr '\n' ' '
}
# Everything the scenarios started is killed even when a row fails (only pids they recorded, and their groups).
reap() {
    local D p
    for D in "$T"/*.*/; do for p in $(left_of "$D"); do kill -9 "$p" 2>/dev/null; done; done
    rm -rf "${T:?}"
}
trap reap EXIT

# System tools without any timeout tool (stock macOS), so each hook's own fallback runs.
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

# A `sleep` run through PATH (a timer's) records its pid and its parent's, then becomes the real sleep.
warm_stub "$T/bin/sleep" 'echo "$$ $PPID" >> "$SLEEP_PIDS"; exec /bin/sleep "$@"' || fail "sleep wrapper warms up" "it did not run"

# The bounded command: records its pid and its parent's, forks a 60 s sleep (records it), then becomes a 60 s sleep. Warmed, so the
# macOS first-exec scan happens here.
warm_stub "$T/hang" 'echo $PPID > "$1/super.pid"; echo $$ > "$1/leader.pid"; /bin/sleep 60 & echo $! > "$1/child.pid"; exec /bin/sleep 60' \
    || fail "the bounded command stub warms up" "it did not run"
# The observer (T81): CORE::GLOBAL overrides of kill and waitpid, loaded through PERL5OPT, so every kill and wait the
# supervisor makes is recorded as it happens, with the hook's code unchanged. It keeps $? as waitpid set it.
mkdir -p "$T/plib"
cat > "$T/plib/OssBoundObserver.pm" <<'PM'
package OssBoundObserver;
sub note { my $f = $ENV{OSS_BOUND_OBSERVER_LOG} or return; open(my $h, ">>", $f) or return; print $h "$_[0]\n"; close $h }
BEGIN {
    *CORE::GLOBAL::kill = sub { my ($sig, @to) = @_; note("kill") if grep { $_ < 0 } @to; CORE::kill($sig, @to) };
    *CORE::GLOBAL::waitpid = sub { my $r = CORE::waitpid($_[0], $_[1]); my $st = $?; note("reap") if $r > 0 && $r == $_[0]; $? = $st; $r };
}
1;
PM
OBSERVE="-I$T/plib -MOssBoundObserver"
# The driver (the hook): its pid, then one bounded call; it says so if the call ever returns.
cat > "$T/driver.sh" <<'DRIVER'
fn=$1; src=$2; secs=$3; D=$4; cmd=$5; [[ $6 == strict ]] && set -euo pipefail
source "$src"
echo $$ > "$D/hook.pid"
"$fn" "$secs" "$cmd" "$D"
echo "returned" > "$D/returned"
DRIVER

# scenario <label> <function file> <function> <shell options: strict|plain> <group-KILL|group-TERM|TERM|HUP>
scenario() {
    local D="$T/$3.$5" hook i left c l bg before
    mkdir -p "$D"
    SLEEP_PIDS="$D/sleep.pids" PATH="$T/bin:$T/sys" run_capped 30 \
        /usr/bin/env PERL5OPT="$OBSERVE" OSS_BOUND_OBSERVER_LOG="$D/trace" /bin/bash "$T/driver.sh" "$3" "$2" "$BOUND" "$D" "$T/hang" "$4" \
        >"$D/out" 2>"$D/err" &
    bg=$!
    for ((i = 0; i < 100; i++)); do [[ -s "$D/child.pid" ]] && break; /bin/sleep 0.05; done
    hook=$(cat "$D/hook.pid" 2>/dev/null); l=$(cat "$D/leader.pid" 2>/dev/null); c=$(cat "$D/child.pid" 2>/dev/null)
    if [[ -z "$hook" || -z "$c" || -e "$D/returned" ]]; then
        fail "$1: $5 mid-bound (setup)" "the bounded call never started: hook=[$hook] leader=[$l] child=[$c]"
        wait "$bg" 2>/dev/null; return
    fi
    before=$(left_of "$D")
    case "$5" in
        group-KILL) kill -KILL -- "-$hook" ;;
        group-TERM) kill -TERM -- "-$hook" ;;
        TERM) kill -TERM "$hook" ;;
        HUP) kill -HUP "$hook" ;;
    esac
    wait "$bg" 2>/dev/null
    left=""
    for ((i = 0; i < 20; i++)); do
        left=$(left_of "$D"); [[ -z "$left" ]] && break; /bin/sleep 0.1
    done
    local cmd_left="" p
    for p in $l $c; do kill -0 "$p" 2>/dev/null && cmd_left="$cmd_left $p"; done
    if [[ ! -e "$D/returned" && -z "$cmd_left" ]]; then
        pass "$1: hook killed ($5) mid-bound: the bounded command and its child end with it"
    else fail "$1: hook killed ($5) mid-bound: the bounded command and its child end with it" \
        "returned=$([[ -e "$D/returned" ]] && echo yes || echo no) alive=[${cmd_left# }] err=$(head -3 "$D/err" | tr '\n' '|')"; fi
    if [[ -z "$left" && -n "$before" ]]; then
        pass "$1: hook killed ($5) mid-bound: nothing of the call is left, so nothing can signal a group later"
    else fail "$1: hook killed ($5) mid-bound: nothing of the call is left, so nothing can signal a group later" \
        "before the kill: [$before] left 2 s after: [$left] $(ps -o pid=,pgid=,command= -p "${left// /,}" 2>/dev/null | tr '\n' '|' | cut -c1-300)"; fi
    trace_check "$1: hook killed ($5) mid-bound" "$D/trace" kill
    for p in $left; do kill -9 "$p" 2>/dev/null; done
}

# trace_check <label> <trace file> <kill|nokill>: one reap, last; no group kill after it; with "kill", at least one
# group kill before it (the leader was still unreaped); with "nokill", none at all.
trace_check() {
    local got want="$3" i
    for ((i = 0; i < 20; i++)); do grep -q '^reap$' "$2" 2>/dev/null && break; /bin/sleep 0.1; done
    got=$(awk '/^reap$/ { r++; next } /^kill$/ { k++; if (r) late++ } END { printf "kills=%d reaps=%d kills-after-reap=%d last=%s", k, r, late, $0 }' "$2" 2>/dev/null)
    if [[ "$want" == kill ]]; then
        [[ "$got" =~ ^kills=[1-9][0-9]*\ reaps=1\ kills-after-reap=0\ last=reap$ ]]
    else [[ "$got" == "kills=0 reaps=1 kills-after-reap=0 last=reap" ]]; fi
    if [[ $? -eq 0 ]]; then pass "$1: the group is signalled only before its leader is reaped (trace: $got)"
    else fail "$1: the group is signalled only before its leader is reaped" "trace: [$got] $(cat "$2" 2>/dev/null | tr '\n' ' ')"; fi
}

# The bound itself and a call that ends in time, traced: the bound kills the group before the reap; a call that
# ends in time is reaped and never signalled.
cat > "$T/bound.sh" <<'BOUND'
fn=$1; src=$2; D=$3; cmd=$4; [[ $5 == strict ]] && set -euo pipefail
source "$src"
rc=0; OSS_BOUND_OBSERVER_LOG="$D/bound.trace" "$fn" 1 "$cmd" "$D" || rc=$?; echo "bound rc=$rc"
rc=0; OSS_BOUND_OBSERVER_LOG="$D/fast.trace" "$fn" 5 /bin/sh -c 'exit 3' || rc=$?; echo "fast rc=$rc"
n=0; for ((i = 0; i < 20; i++)); do [[ "$("$fn" 0.8 /bin/sh -c '/bin/sleep 0.2; echo ok' || true)" == ok ]] && n=$((n + 1)); done
echo "sub-second ok=$n"
BOUND
traced() {
    local D="$T/$3.traced"; mkdir -p "$D"
    PATH="$T/sys" run_capped 30 /usr/bin/env PERL5OPT="$OBSERVE" /bin/bash "$T/bound.sh" "$3" "$2" "$D" "$T/hang" "$4" >"$D/out" 2>"$D/err"
    local want_b=137 want_f=3; [[ "$3" == run_with_timeout ]] && { want_b=0; want_f=0; }   # oss-notify: `|| true`
    grep -qx "bound rc=$want_b" "$D/out" && grep -qx "fast rc=$want_f" "$D/out" \
        && pass "$1: exit status at the bound and in time is kept ($want_b, $want_f)" \
        || fail "$1: exit status at the bound and in time is kept ($want_b, $want_f)" "$(tr '\n' '|' < "$D/out") err=$(head -3 "$D/err" | tr '\n' '|')"
    grep -qx "sub-second ok=20" "$D/out" && pass "$1: a sub-second bound never fires early (20 calls of 0.2 s under 0.8 s)" \
        || fail "$1: a sub-second bound never fires early (20 calls of 0.2 s under 0.8 s)" "$(grep sub-second "$D/out")"
    trace_check "$1: the bound fires" "$D/bound.trace" kill
    trace_check "$1: the call ends in time" "$D/fast.trace" nokill
    for p in $(cat "$D/leader.pid" "$D/child.pid" 2>/dev/null); do kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null; done
}

for spec in "session start|oss-session-start.sh|run_bounded|plain" "oss-notify|oss-notify.sh|run_with_timeout|strict"; do
    IFS='|' read -r label file fn opts <<< "$spec"
    sed -n "/^$fn() {/,/^}/p" "$HOOKS/$file" > "$T/$fn.sh"
    if ! grep -q "$fn()" "$T/$fn.sh"; then fail "$label: $fn is read from the hook (anchor)" "no $fn() in $file"; continue; fi
    for how in group-KILL group-TERM TERM HUP; do scenario "$label" "$T/$fn.sh" "$fn" "$opts" "$how"; done
    traced "$label" "$T/$fn.sh" "$fn" "$opts"
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
