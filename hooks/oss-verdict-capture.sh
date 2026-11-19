#!/bin/bash
# oss-verdict-capture.sh - SubagentStop: records a review agent's own verdict block for ship (R-257 T19, D6, D14).
# oss-verdict-capture.sh start - SubagentStart: records that agent's start snapshot (round 2 security L4), so a verdict
# counts only for code that did not change while the agent ran.
#
# Registered in hooks.json under SubagentStop as its own entry, after R-266's `oss-gate-run.sh subagent-stop`, and
# with `start` under SubagentStart, after R-266's `oss-gate-run.sh subagent-start`.
# Reads Claude Code's SubagentStop input on stdin (session_id, cwd, agent_id, agent_type, agent_transcript_path; the
# CLI takes the verdict only from that transcript under ~/.claude/projects, never from last_assistant_message, D41);
# at most 1 MB is read, into a private temp folder (0700) that is removed
# afterwards. Only the four review agents, by their exact plugin agent_type (oss:code-reviewer, oss:security-auditor,
# oss:penetration-tester, oss:performance-auditor; case-sensitive), start node: a bash match on agent_type. A bare name
# (a project agent in .claude/agents) or another prefix never does (round 1 finding 5); the CLI checks the same list. The capture CLI (watcher/dist/cli/verdict-capture.cjs, found by oss_plugin_cli) runs on the recorded node
# (oss_plugin_node, D21), bounded at 7 s by oss_run_bounded_rc (hooks.json allows 10 s; the CLI's own git deadline,
# 3.5 s from its process start, leaves the rest for node start and the ledger write, performance LOW 1). The CLI parses the input as JSON, takes the gate
# name from agent_type and writes the ledger row; nothing from the input reaches a command line.
#
# mktemp, head, grep and rm come from fixed paths (R-266 style, hooks/oss-tool-gate.sh), never PATH, and node runs with
# PATH=/usr/bin:/bin, so a program planted early on PATH decides nothing.
#
# ALWAYS exits 0 and prints nothing on stdout or stderr: a capture failure never blocks or changes a subagent's stop.

_ovc_main() {
    local here sub="watcher/dist/cli/verdict-capture.cjs" dir in re mode=()
    [[ "${1:-}" == start ]] && mode=(start)
    # Security L5: the hook's own folder with builtins only, never PATH's dirname (as oss-stop-dispatch.sh does).
    here="${BASH_SOURCE[0]%/*}"; [[ "$here" == "${BASH_SOURCE[0]}" ]] && here=.
    here="$(cd "$here" 2>/dev/null && pwd)" || return 0
    dir="$(umask 077 && /usr/bin/mktemp -d 2>/dev/null)" || return 0
    in="$dir/input.json"
    /usr/bin/head -c 1048576 > "$in" 2>/dev/null
    re='"agent_type"[[:space:]]*:[[:space:]]*"oss:(code-reviewer|security-auditor|penetration-tester|performance-auditor)"'
    if /usr/bin/grep -Eq "$re" "$in" 2>/dev/null && [[ -f "$here/oss-phase-result.sh" && ! -L "$here/oss-phase-result.sh" ]]; then
        # shellcheck source=oss-phase-result.sh
        source "$here/oss-phase-result.sh"
        if oss_plugin_cli "$sub" && oss_plugin_node "$_OSS_PLUGIN_CLI" "$sub"; then
            oss_run_bounded_rc 7 /usr/bin/env PATH=/usr/bin:/bin "$OSS_NODE" "$_OSS_PLUGIN_CLI" ${mode[@]+"${mode[@]}"} "$in"
        fi
    fi
    /bin/rm -rf "$dir"
    return 0
}

_ovc_main "$@" >/dev/null 2>&1
exit 0
