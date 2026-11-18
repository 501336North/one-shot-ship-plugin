#!/bin/bash
# oss-verdict-capture.sh - SubagentStop: records a review agent's own verdict block for ship (R-257 T19, D6, D14).
#
# Registered in hooks.json under SubagentStop as its own entry, after R-266's `oss-gate-run.sh subagent-stop`.
# Reads Claude Code's SubagentStop input on stdin (session_id, cwd, agent_id, agent_type, agent_transcript_path and,
# in newer versions, last_assistant_message); at most 1 MB is read, into a private temp folder (0700) that is removed
# afterwards. Only the four review agents (code-reviewer, security-auditor, penetration-tester, performance-auditor,
# with or without a plugin prefix) start node: a bash match on agent_type, the same plain-id shape oss-gate-run.sh
# reads. The capture CLI (watcher/dist/cli/verdict-capture.cjs, found by oss_plugin_cli) runs on the recorded node
# (oss_plugin_node, D21), bounded at 5 s by oss_run_bounded_rc. The CLI parses the input as JSON, takes the gate
# name from agent_type and writes the ledger row; nothing from the input reaches a command line.
#
# ALWAYS exits 0 and prints nothing on stdout or stderr: a capture failure never blocks or changes a subagent's stop.

_ovc_main() {
    local here sub="watcher/dist/cli/verdict-capture.cjs" dir in re
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || return 0
    dir="$(umask 077 && mktemp -d 2>/dev/null)" || return 0
    in="$dir/input.json"
    head -c 1048576 > "$in" 2>/dev/null
    re='"agent_type"[[:space:]]*:[[:space:]]*"([A-Za-z0-9_.-]{1,64}:)?(code-reviewer|security-auditor|penetration-tester|performance-auditor)"'
    if grep -Eiq "$re" "$in" 2>/dev/null && [[ -f "$here/oss-phase-result.sh" && ! -L "$here/oss-phase-result.sh" ]]; then
        # shellcheck source=oss-phase-result.sh
        source "$here/oss-phase-result.sh"
        if oss_plugin_cli "$sub" && oss_plugin_node "$_OSS_PLUGIN_CLI" "$sub"; then
            oss_run_bounded_rc 5 "$OSS_NODE" "$_OSS_PLUGIN_CLI" "$in"
        fi
    fi
    rm -rf "$dir"
    return 0
}

_ovc_main >/dev/null 2>&1
exit 0
