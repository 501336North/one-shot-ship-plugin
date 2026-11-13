#!/bin/bash
# Phase results (R-257): the bounded runner and the gate verdict behind `oss-notify --workflow <phase> complete`.
# T9a: runner + verdict only. T9 adds the assemble/check verbs (node at
# $CLAUDE_PLUGIN_ROOT/watcher/dist/cli/phase-result.cjs). Sourcing this file defines functions and does nothing else.

# oss_run_bounded_rc <seconds> <cmd...>
#   Runs <cmd> (stdin /dev/null) in its own process group as a background child, with a watchdog that kills the
#   group at <seconds>. Stdout goes to OSS_BOUNDED_OUT (trailing newlines dropped). Returns the command's real
#   exit code: 124 on timeout, 127 when the command cannot be found. Needs no timeout binary (stock macOS).
#   Unlike run_with_timeout (oss-notify.sh), it never swallows the exit code.
oss_run_bounded_rc() {
    local secs="$1" dir pid wd rc
    shift
    OSS_BOUNDED_OUT=""
    dir=$(mktemp -d) || return 125
    # The child leads its own process group so the watchdog can end everything it started.
    /usr/bin/perl -e 'setpgrp(0, 0); exec { $ARGV[0] } @ARGV; exit($!{ENOENT} ? 127 : 126)' "$@" \
        </dev/null >"$dir/out" &
    pid=$!
    # The watchdog is one process (no orphaned sleep): it marks the timeout, then TERMs and KILLs the group.
    /usr/bin/perl -e '
        my ($s, $p, $m) = @ARGV;
        select(undef, undef, undef, $s);
        open(my $f, ">", $m) and close($f);
        kill "TERM", -$p; select(undef, undef, undef, 0.5);
        kill "KILL", -$p; kill "KILL", $p;
    ' "$secs" "$pid" "$dir/timed_out" </dev/null >/dev/null 2>&1 &
    wd=$!
    wait "$pid" 2>/dev/null; rc=$?
    kill -KILL "$wd" 2>/dev/null
    wait "$wd" 2>/dev/null
    [[ -e "$dir/timed_out" ]] && rc=124
    OSS_BOUNDED_OUT=$(cat "$dir/out")
    rm -rf "$dir"
    return "$rc"
}

# oss_phase_gate_ok <rc> <stdout>
#   True only when rc is 0 AND stdout is JSON whose .verification is "verified" (checked with jq). Otherwise false,
#   with a reason class on stderr: timeout, cli_missing, exit_<rc>, no_output or not_verified.
oss_phase_gate_ok() {
    local rc="$1" out="$2"
    if [[ "$rc" == 124 ]]; then echo "timeout" >&2; return 1; fi
    if [[ "$rc" == 127 ]]; then echo "cli_missing" >&2; return 1; fi
    if [[ "$rc" != 0 ]]; then echo "exit_$rc" >&2; return 1; fi
    if [[ -z "$out" ]]; then echo "no_output" >&2; return 1; fi
    if printf '%s' "$out" | jq -e '.verification == "verified"' >/dev/null 2>&1; then return 0; fi
    echo "not_verified" >&2
    return 1
}

oss_phase_result_main() {
    echo "usage: oss-phase-result.sh <assemble|check> ... (not available yet)" >&2
    return 2
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    oss_phase_result_main "$@"
    exit $?
fi
