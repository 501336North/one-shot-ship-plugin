#!/bin/bash
# hooks/__tests__/lib/run-capped.sh: run_capped runs a command under a time cap and leaves nothing behind (T49).
#
# @behavior `run_capped SECONDS cmd args...` runs the command in its own process group.
#           - On the cap it kills the WHOLE group (a reader of /dev/zero, a child that ignores SIGTERM) and
#             returns RUN_CAPPED_CAP_RC.
#           - After any run it checks the group: a member that outlived the command (a background job) is
#             killed, the call fails with RUN_CAPPED_LEAK_RC and says so on stderr.
#           - A command that finishes normally keeps its own exit status, stdout and stderr, and is not killed.
# @business-rule No hook test may leave a process running after it (2026-10-30: orphaned `jq -s` readers of
#           /dev/zero, left by a cap that killed only the hook's shell, piled up and likely crashed the Mac).
#
# Usage:   /bin/bash hooks/__tests__/run-capped.test.sh
#          RUN_CAPPED_LIB=/path/to/run-capped.sh /bin/bash ...   (runs against a copy, for mutants)
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running run-capped tests..."

# Every process this test starts carries MARK in its argv (the tools are symlinks named after it), so
# `pgrep -f "$MARK"` finds exactly this run's processes, and the EXIT trap ends any of them whatever happens.
MARK="rcap-$$-$RANDOM"
T=$(mktemp -d); T=$(cd "$T" && pwd -P)
trap 'pkill -KILL -f "$MARK" 2>/dev/null; rm -rf "$T"' EXIT
ln -s /bin/cat "$T/cat-$MARK"
ln -s /bin/sleep "$T/sleep-$MARK"

# shellcheck source=lib/run-capped.sh
source "${RUN_CAPPED_LIB:-$SCRIPT_DIR/lib/run-capped.sh}" 2>/dev/null \
    || { fail "lib/run-capped.sh can be sourced" "missing"; echo "Tests run: $RUN, failed: $FAILED"; exit 1; }

# survivors : prints this run's processes still alive (after a moment for the KILLed to be reaped), and kills them.
survivors() {
    local i=0
    while pgrep -f "$MARK" >/dev/null && ((i < 20)); do sleep 0.1; i=$((i + 1)); done
    pgrep -fl "$MARK"
    pkill -KILL -f "$MARK" 2>/dev/null
    return 0
}

# rc_run SECONDS cmd... : run_capped, output to $T/out and $T/err (never $(...): a survivor holding the pipe would
# hang the test itself), status in RC. A watchdog, one process, ends this run's processes after 20 s, so a broken
# helper (a mutant without setpgrp waited forever on a reader of /dev/zero) fails the case instead of hanging.
rc_run() {
    RCAP_MARK="$MARK" /usr/bin/perl -e 'sleep 20; exec "/usr/bin/pkill", "-KILL", "-f", $ENV{RCAP_MARK}' \
        </dev/null >/dev/null 2>&1 &
    local wd=$!
    RC=0
    run_capped "$@" >"$T/out" 2>"$T/err" || RC=$?
    kill "$wd" 2>/dev/null; wait "$wd" 2>/dev/null
}

# 1. endless input: a reader of /dev/zero is stopped by the cap, and so is its pipeline partner.
start=$SECONDS
rc_run 1 /bin/bash -c '"$1" /dev/zero | "$1" >/dev/null' _ "$T/cat-$MARK"
took=$((SECONDS - start)); left=$(survivors)
[[ $RC -eq $RUN_CAPPED_CAP_RC ]] && pass "endless input: the cap code ($RC)" \
    || fail "endless input: the cap code" "rc=$RC want=$RUN_CAPPED_CAP_RC err=$(cat "$T/err")"
[[ -z "$left" ]] && pass "endless input: no reader of /dev/zero outlives the cap" || fail "endless input: no survivor" "$left"
((took < 10)) && pass "endless input: the call returns soon after the cap (${took}s)" || fail "endless input: returns" "took ${took}s"

# 2. a child that ignores SIGTERM is still stopped.
rc_run 1 /bin/bash -c 'trap "" TERM; "$1" 1000' _ "$T/sleep-$MARK"
left=$(survivors)
[[ $RC -eq $RUN_CAPPED_CAP_RC ]] && pass "TERM ignored: the cap code ($RC)" \
    || fail "TERM ignored: the cap code" "rc=$RC want=$RUN_CAPPED_CAP_RC err=$(cat "$T/err")"
[[ -z "$left" ]] && pass "TERM ignored: nothing outlives the cap" || fail "TERM ignored: no survivor" "$left"

# 3a. a grandchild in a background job, still running when the cap fires.
rc_run 1 /bin/bash -c '( "$1" 1000 ) </dev/null >/dev/null 2>&1 & "$1" 1000' _ "$T/sleep-$MARK"
left=$(survivors)
[[ $RC -eq $RUN_CAPPED_CAP_RC ]] && pass "background job at the cap: the cap code ($RC)" \
    || fail "background job at the cap: the cap code" "rc=$RC want=$RUN_CAPPED_CAP_RC err=$(cat "$T/err")"
[[ -z "$left" ]] && pass "background job at the cap: the grandchild does not survive" || fail "background job at the cap: no survivor" "$left"

# 3b. a grandchild in a background job that outlives a command which itself ends at once: killed, and the call fails.
start=$SECONDS
rc_run 30 /bin/bash -c '( "$1" 1000 ) </dev/null >/dev/null 2>&1 & exit 0' _ "$T/sleep-$MARK"
took=$((SECONDS - start)); left=$(survivors)
[[ $RC -eq $RUN_CAPPED_LEAK_RC ]] && pass "background job left behind: the call fails ($RC)" \
    || fail "background job left behind: the call fails" "rc=$RC want=$RUN_CAPPED_LEAK_RC"
grep -q 'survived' "$T/err" && pass "background job left behind: stderr says a process survived" \
    || fail "background job left behind: message" "err=$(cat "$T/err")"
[[ -z "$left" ]] && pass "background job left behind: the grandchild is killed" || fail "background job left behind: no survivor" "$left"
((took < 10)) && pass "background job left behind: no wait for the cap (${took}s)" || fail "background job left behind: returns" "took ${took}s"

# 3c. a background job that ends shortly (0.5 s) after the command: it is let finish, and the call succeeds.
start=$SECONDS
rc_run 30 /bin/bash -c '( "$1" 0.5; : > "$2" ) </dev/null >/dev/null 2>&1 & exit 0' _ "$T/sleep-$MARK" "$T/bgdone"
left=$(survivors)
[[ $RC -eq 0 ]] && pass "short background job: the call succeeds" || fail "short background job: the call succeeds" "rc=$RC err=$(cat "$T/err")"
[[ -f "$T/bgdone" ]] && pass "short background job: not killed (it finished its work)" || fail "short background job: not killed" "no done mark"
[[ -z "$left" ]] && pass "short background job: nothing left" || fail "short background job: nothing left" "$left"

# 4. a command that finishes normally: its status, stdout and stderr pass through, and it runs to the end.
rc_run 30 /bin/bash -c '"$1" 0.3; printf "out:%s\n" "$2"; printf "err:%s\n" "$2" >&2; : > "$3"; exit 7' \
    _ "$T/sleep-$MARK" hello "$T/finished"
left=$(survivors)
[[ $RC -eq 7 ]] && pass "normal run: the command's own exit status (7)" || fail "normal run: exit status" "rc=$RC err=$(cat "$T/err")"
[[ "$(cat "$T/out")" == "out:hello" ]] && pass "normal run: stdout unchanged" || fail "normal run: stdout" "out=$(cat "$T/out")"
[[ "$(cat "$T/err")" == "err:hello" ]] && pass "normal run: stderr unchanged" || fail "normal run: stderr" "err=$(cat "$T/err")"
[[ -f "$T/finished" ]] && pass "normal run: not killed (it reached its last line)" || fail "normal run: not killed" "no finish mark"
[[ -z "$left" ]] && pass "normal run: nothing left" || fail "normal run: nothing left" "$left"

rc_run 30 /usr/bin/true
[[ $RC -eq 0 && ! -s "$T/out" && ! -s "$T/err" ]] && pass "normal run: status 0 and no output of its own" \
    || fail "normal run: status 0" "rc=$RC out=$(cat "$T/out") err=$(cat "$T/err")"

[[ "$RUN_CAPPED_CAP_RC" != "$RUN_CAPPED_LEAK_RC" && "$RUN_CAPPED_CAP_RC" != 0 && "$RUN_CAPPED_LEAK_RC" != 0 ]] \
    && pass "cap and leak codes are distinct and non-zero" || fail "distinct codes" "cap=$RUN_CAPPED_CAP_RC leak=$RUN_CAPPED_LEAK_RC"

echo "Tests run: $RUN, failed: $FAILED"
[[ $FAILED -eq 0 ]]
