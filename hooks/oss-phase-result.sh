#!/bin/bash
# Phase results (R-257): the bounded runner and the gate verdict behind `oss-notify --workflow <phase> complete`.
# T9a: runner + verdict. T9: the assemble/check verbs, which run the CLI watcher/dist/cli/phase-result.cjs.
# Sourcing this file defines functions and fixed program paths (OSS_GIT_BIN, OSS_JQ_BIN, OSS_CAT, ...), and does nothing else.

# git and jq come from a fixed path, never PATH's, as node does (oss-node.sh): a fake jq early on PATH could turn a
# refusal into a pass (R-257 ship round 1, LOW security). The first that exists; the bare name only when none does.
_oss_fixed_bin() { # <var> <path...>
    local v="$1" p
    shift
    for p in "$@"; do if [[ -f "$p" && -x "$p" ]]; then printf -v "$v" '%s' "$p"; return 0; fi; done
    printf -v "$v" '%s' "${1##*/}"
}
# D33: the Homebrew fallbacks for git and jq are accepted at the recorded node's trust level (D21).
_oss_fixed_bin OSS_GIT_BIN /usr/bin/git /opt/homebrew/bin/git /usr/local/bin/git /bin/git
_oss_fixed_bin OSS_JQ_BIN /usr/bin/jq /opt/homebrew/bin/jq /usr/local/bin/jq
# Every other tool the gate paths run, R-266 style (oss-tool-gate.sh): a fake cat, mktemp, rm or find early on PATH
# could empty a captured Stop block or pick a forged checker (R-257 ship round 3, pen MEDIUM N3).
_oss_fixed_bin OSS_CAT /bin/cat /usr/bin/cat
_oss_fixed_bin OSS_MKTEMP /usr/bin/mktemp /bin/mktemp
_oss_fixed_bin OSS_RM /bin/rm /usr/bin/rm
_oss_fixed_bin OSS_MKDIR /bin/mkdir /usr/bin/mkdir
_oss_fixed_bin OSS_CUT /usr/bin/cut /bin/cut
_oss_fixed_bin OSS_FIND /usr/bin/find /bin/find
_oss_fixed_bin OSS_SORT /usr/bin/sort /bin/sort
_oss_fixed_bin OSS_TAIL /usr/bin/tail /bin/tail
_oss_fixed_bin OSS_ENV /usr/bin/env /bin/env
# The PATH every node CLI the hooks start runs with: never the caller's (the CLIs take git from fixed paths too).
OSS_NODE_PATH=/usr/bin:/bin

# oss_run_bounded_rc <seconds> <cmd...>
#   Runs <cmd> (stdin /dev/null) in its own process group as a background child, with a watchdog that kills the
#   group at <seconds>. Stdout goes to OSS_BOUNDED_OUT (trailing newlines dropped). Returns the command's real
#   exit code: 124 on timeout, 127 when the command cannot be found. Needs no timeout binary (stock macOS).
#   Unlike run_with_timeout (oss-notify.sh), it never swallows the exit code.
oss_run_bounded_rc() {
    local secs="$1" dir pid wd rc
    shift
    OSS_BOUNDED_OUT=""
    dir=$("$OSS_MKTEMP" -d) || return 125
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
    OSS_BOUNDED_OUT=$("$OSS_CAT" "$dir/out")
    "$OSS_RM" -rf "$dir"
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
    if printf '%s' "$out" | "$OSS_JQ_BIN" -e '.verification == "verified"' >/dev/null 2>&1; then return 0; fi
    echo "not_verified" >&2
    return 1
}

_OSS_PR_SUB="watcher/dist/cli/phase-result.cjs"

# oss_plugin_root_file -> _OSS_ROOT_FILE: the physical folder ~/.oss/plugin-root names, used only when the file is as
#   session-start writes it: a regular file, not a link, owned by the user, mode 600, one absolute line naming a folder
#   that is not a link and is owned by the user (D25 c; the tool gate protects the file). "" and 1 otherwise.
oss_plugin_root_file() {
    local f="$HOME/.oss/plugin-root" r="" m
    _OSS_ROOT_FILE=""
    [[ -f "$f" && ! -L "$f" && -O "$f" ]] || return 1
    m=$(/usr/bin/stat -c '%a' "$f" 2>/dev/null || /usr/bin/stat -f '%Lp' "$f" 2>/dev/null) && [[ "$m" == 600 ]] || return 1
    IFS= read -r -d '' r <"$f"
    r="${r%$'\n'}"
    [[ "$r" == /* && "$r" != *$'\n'* && -d "$r" && ! -L "$r" && -O "$r" ]] || return 1
    _OSS_ROOT_FILE=$(CDPATH='' cd -P -- "$r" 2>/dev/null && pwd -P) && [[ -n "$_OSS_ROOT_FILE" ]]
}

# oss_trusted_root <dir> -> _OSS_TRUSTED: true when <dir> resolves physically (pwd -P) to the folder the protected
#   ~/.oss/plugin-root names (call oss_plugin_root_file first) or lies under ~/.claude/plugins/ (D25 b). Anything else,
#   such as a model folder in a CLAUDE_PLUGIN_ROOT prefix or ~/.oss itself, is not a plugin.
oss_trusted_root() {
    local d plugins
    _OSS_TRUSTED=""
    d=$(CDPATH='' cd -P -- "$1" 2>/dev/null && pwd -P) && [[ -n "$d" ]] || return 1
    plugins=$(CDPATH='' cd -P -- "$HOME/.claude/plugins" 2>/dev/null && pwd -P) || plugins=""
    if [[ -n "$_OSS_ROOT_FILE" && "$d" == "$_OSS_ROOT_FILE" ]] || [[ -n "$plugins" && "$d" == "$plugins"/* ]]; then
        _OSS_TRUSTED="$d"; return 0
    fi
    return 1
}

# oss_plugin_cli <sub> -> _OSS_PLUGIN_CLI, the plugin file <sub> (e.g. watcher/dist/cli/phase-result.cjs).
#   Order (R-267 finding c, user pick 2026-11-13; D25 2026-11-18): $CLAUDE_PLUGIN_ROOT only when oss_trusted_root
#   accepts it, the plugin named by ~/.oss/plugin-root (oss_plugin_root_file), then the plugin cache. This script's own
#   folder is never used: for the ~/.oss/hooks copy it is ~/.oss (D25 d). Returns 1 when none holds it. Shared by
#   oss_phase_result_cli, oss-stop-dispatch.sh and oss-verdict-capture.sh.
oss_plugin_cli() {
    local sub="$1" found
    _OSS_PLUGIN_CLI=""
    oss_plugin_root_file || true
    if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]] && oss_trusted_root "$CLAUDE_PLUGIN_ROOT" && [[ -f "$_OSS_TRUSTED/$sub" ]]; then
        _OSS_PLUGIN_CLI="$_OSS_TRUSTED/$sub"; return 0
    fi
    if [[ -n "$_OSS_ROOT_FILE" && -f "$_OSS_ROOT_FILE/$sub" ]]; then _OSS_PLUGIN_CLI="$_OSS_ROOT_FILE/$sub"; return 0; fi
    found=$("$OSS_FIND" "$HOME/.claude/plugins/cache/one-shot-ship-plugin" -name "${sub##*/}" -path "*/$sub" -type f 2>/dev/null | "$OSS_SORT" -V | "$OSS_TAIL" -1)
    if [[ -n "$found" ]]; then _OSS_PLUGIN_CLI="$found"; return 0; fi
    return 1
}

# oss_phase_result_cli -> _OSS_PR_CLI: the phase-result CLI, found by oss_plugin_cli. Returns 1 when none holds it.
oss_phase_result_cli() {
    _OSS_PR_CLI=""
    oss_plugin_cli "$_OSS_PR_SUB" || return 1
    _OSS_PR_CLI="$_OSS_PLUGIN_CLI"
}

# oss_plugin_node [<cli> <sub>] -> OSS_NODE: the node recorded in ~/.oss/node-path, through ~/.oss/hooks/oss-node.sh,
#   never PATH's: a fake node early on PATH could forge a verdict (R-257 T26, security C1). That oss-node.sh is the copy
#   the tool gate protects (D25 e): a regular file, not a link, owned by the user. The chosen plugin root's own copy is
#   never sourced; the arguments are kept for callers and unused. With none, or no usable node: one node_missing line
#   on stderr and 127 (what cli_missing returns, so callers treat it as "no check").
oss_plugin_node() {
    local f="$HOME/.oss/hooks/oss-node.sh"
    OSS_NODE_PROBLEM=""
    if [[ -f "$f" && ! -L "$f" && -O "$f" ]] && source "$f" && oss_node; then return 0; fi
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
    echo "       oss-phase-result.sh check ship --record-ready" >&2
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
        # D78: check ship --record-ready (the wrapper's Step 8 record call; the CLI takes it alone)
        elif [[ "$verb" == check && "$phase" == ship && "$1" == --record-ready ]]; then rest+=("--record-ready"); shift
        elif [[ "$verb" == check && "$1" == --repo && $# -ge 2 ]]; then rest+=("--repo" "$2"); shift 2
        else _oss_phase_result_usage; return 2; fi
    done
    if ! oss_phase_result_cli; then
        echo "oss-phase-result: cli_missing: $_OSS_PR_SUB not found (CLAUDE_PLUGIN_ROOT, ~/.oss/plugin-root, plugin cache)" >&2
        return 127
    fi
    oss_plugin_node "$_OSS_PR_CLI" "$_OSS_PR_SUB" || return 127
    # D86: the caller's PATH goes along as OSS_GH_PATH, only for complete's `gh` merge proof (node itself keeps the fixed PATH).
    oss_run_bounded_rc "$secs" "$OSS_ENV" PATH="$OSS_NODE_PATH" OSS_GH_PATH="$PATH" "$OSS_NODE" "$_OSS_PR_CLI" "$verb" "$phase" ${rest[@]+"${rest[@]}"}
    rc=$?
    [[ -n "$OSS_BOUNDED_OUT" ]] && printf '%s\n' "$OSS_BOUNDED_OUT"
    # Perf F2 (gate round 12): the slow part is usually git diff on a repo of many loose objects, which git gc packs.
    [[ "$rc" == 124 ]] && echo "oss-phase-result: timeout: $verb $phase passed ${secs}s (often many loose objects: run git gc, then try again)" >&2
    return "$rc"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    oss_phase_result_main "$@"
    exit $?
fi
