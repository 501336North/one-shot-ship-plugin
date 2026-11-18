#!/bin/bash
# Phase results (R-257): the bounded runner and the gate verdict behind `oss-notify --workflow <phase> complete`.
# T9a: runner + verdict. T9: the assemble/check verbs, which run the CLI watcher/dist/cli/phase-result.cjs.
# Sourcing this file defines functions and does nothing else.

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

_OSS_PR_SUB="watcher/dist/cli/phase-result.cjs"

# oss_plugin_cli <sub> -> _OSS_PLUGIN_CLI, the plugin file <sub> (e.g. watcher/dist/cli/phase-result.cjs).
#   Order (R-267 finding c, user pick 2026-11-13): $CLAUDE_PLUGIN_ROOT, the plugin named by ~/.oss/plugin-root (not a
#   link, owned, absolute, one line, a folder: the same checks as the value script's root verb), this script's own
#   plugin, then the plugin cache. Returns 1 when none holds it. Shared by oss_phase_result_cli and oss-stop-dispatch.sh.
oss_plugin_cli() {
    local sub="$1" f="$HOME/.oss/plugin-root" r="" here found
    _OSS_PLUGIN_CLI=""
    if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" && -f "$CLAUDE_PLUGIN_ROOT/$sub" ]]; then
        _OSS_PLUGIN_CLI="$CLAUDE_PLUGIN_ROOT/$sub"; return 0
    fi
    if [[ -f "$f" && ! -L "$f" && -O "$f" ]] && IFS= read -r -d '' r <"$f"; [[ -n "$r" ]]; then
        r="${r%$'\n'}"
        if [[ "$r" == /* && "$r" != *$'\n'* && -d "$r" && -f "$r/$sub" ]]; then
            _OSS_PLUGIN_CLI="$r/$sub"; return 0
        fi
    fi
    here="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd -P)"
    if [[ -n "$here" && -f "$here/$sub" ]]; then _OSS_PLUGIN_CLI="$here/$sub"; return 0; fi
    found=$(find "$HOME/.claude/plugins/cache/one-shot-ship-plugin" -name "${sub##*/}" -path "*/$sub" -type f 2>/dev/null | sort -V | tail -1)
    if [[ -n "$found" ]]; then _OSS_PLUGIN_CLI="$found"; return 0; fi
    return 1
}

# oss_phase_result_cli -> _OSS_PR_CLI: the phase-result CLI, found by oss_plugin_cli. Returns 1 when none holds it.
oss_phase_result_cli() {
    _OSS_PR_CLI=""
    oss_plugin_cli "$_OSS_PR_SUB" || return 1
    _OSS_PR_CLI="$_OSS_PLUGIN_CLI"
}

# oss_plugin_node <cli> <sub> -> OSS_NODE: the node recorded in ~/.oss/node-path, through hooks/oss-node.sh of the
#   plugin the CLI came from (<cli> minus <sub>), never PATH's: a fake node early on PATH could forge a verdict
#   (R-257 T26, security C1). That oss-node.sh must be a regular file, not a link. With none, or no usable node: one
#   node_missing line on stderr and 127 (what cli_missing returns, so callers treat it as "no check").
oss_plugin_node() {
    local f="${1%"$2"}hooks/oss-node.sh"
    OSS_NODE_PROBLEM=""
    if [[ -f "$f" && ! -L "$f" ]] && source "$f" && oss_node; then return 0; fi
    if [[ "$OSS_NODE_PROBLEM" == changed ]]; then
        echo "oss-phase-result: node_missing: the node recorded in ~/.oss/node-path changed (${OSS_NODE_OLD:-unreadable} is not usable, PATH has $OSS_NODE_NEW); delete ~/.oss/node-path if you changed node yourself" >&2
    else
        echo "oss-phase-result: node_missing: no usable node recorded in ~/.oss/node-path (start a new Claude session to record it)" >&2
    fi
    return 127
}

_oss_phase_result_usage() {
    echo "usage: oss-phase-result.sh assemble <ideate|plan|build|ship>" >&2
    echo "       oss-phase-result.sh check <ideate|plan|build|ship> [--repo <path>] [--all]" >&2
    return 2
}

# oss_phase_result_main assemble <phase> | check <phase> [--repo P] [--all]
#   Checks the verb, phase and flags against fixed lists (before node runs), then runs the CLI bounded (assemble 30 s,
#   check 10 s), forwards its stdout and stderr and returns its exit code. No CLI anywhere: 127 and cli_missing.
oss_phase_result_main() {
    local verb="${1:-}" phase="${2:-}" secs rc
    case "$verb" in assemble) secs=30 ;; check) secs=10 ;; *) _oss_phase_result_usage; return 2 ;; esac
    case "$phase" in ideate|plan|build|ship) ;; *) _oss_phase_result_usage; return 2 ;; esac
    shift 2
    local -a rest=()
    while [[ $# -gt 0 ]]; do
        if [[ "$verb" == check && "$1" == --all ]]; then rest+=("--all"); shift
        elif [[ "$verb" == check && "$1" == --repo && $# -ge 2 ]]; then rest+=("--repo" "$2"); shift 2
        else _oss_phase_result_usage; return 2; fi
    done
    if ! oss_phase_result_cli; then
        echo "oss-phase-result: cli_missing: $_OSS_PR_SUB not found (CLAUDE_PLUGIN_ROOT, ~/.oss/plugin-root, plugin cache)" >&2
        return 127
    fi
    oss_plugin_node "$_OSS_PR_CLI" "$_OSS_PR_SUB" || return 127
    oss_run_bounded_rc "$secs" "$OSS_NODE" "$_OSS_PR_CLI" "$verb" "$phase" ${rest[@]+"${rest[@]}"}
    rc=$?
    [[ -n "$OSS_BOUNDED_OUT" ]] && printf '%s\n' "$OSS_BOUNDED_OUT"
    [[ "$rc" == 124 ]] && echo "oss-phase-result: timeout: $verb $phase passed ${secs}s" >&2
    return "$rc"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    oss_phase_result_main "$@"
    exit $?
fi
