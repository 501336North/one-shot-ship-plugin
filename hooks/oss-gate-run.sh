#!/bin/bash
# oss-gate-run.sh subagent-start|subagent-stop|agent-post - the review-run check (R-266, ADR-009),
# hook JSON on stdin.
#
# Registered in hooks.json: SubagentStart → subagent-start, SubagentStop → subagent-stop,
# PostToolUse (Agent|Task) → agent-post. Not async: the check's answer is hook output.
#
# The check's answer is returned as is (exit 0 with its stdout). Any other outcome (a non-zero exit,
# a missing CLI, no node, a killed process) means the check itself failed: the run is allowed, the
# user is told the review is unverified, and one fixed gate-error line is logged. Nothing from the
# hook input is read here: stdin goes straight to the CLI, so no input text reaches a command or the log.
set -u

EVENT="${1:-}"

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" 2>/dev/null && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"
# The gate list comes from CLAUDE_PLUGIN_ROOT: always the plugin's root, never the working folder.
export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
CLI="$PLUGIN_ROOT/watcher/dist/cli/gate-run.cjs"

# The project folder: CLAUDE_PROJECT_DIR when it is an existing absolute folder, else the nearest
# folder holding .git at or above this hook's folder, else this folder.
project_root() {
    local dir="${CLAUDE_PROJECT_DIR:-}"
    case "$dir" in
        /*) if [ -d "$dir" ]; then echo "$dir"; return; fi ;;
    esac
    dir="$PWD"
    while :; do
        if [ -e "$dir/.git" ]; then echo "$dir"; return; fi
        [ "$dir" = / ] && break
        dir="${dir%/*}"
        dir="${dir:-/}"
    done
    echo "$PWD"
}

# Appends one gate-error line to <project>/.oss/tool-gates/events.ndjson, the tool gate's event log,
# with the same refusals as the tool gate: a symlinked .oss, .oss/tool-gates or events.ndjson, or a
# state folder that resolves outside the project. Best effort.
log_gate_error() {
    local root state real_state real_root
    root="$(project_root)"
    state="$root/.oss/tool-gates"
    if [ -L "$root/.oss" ] || [ -L "$state" ]; then return; fi
    mkdir -p "$state" 2>/dev/null || return
    real_state="$(cd -P "$state" 2>/dev/null && pwd)" || return
    real_root="$(cd -P "$root" 2>/dev/null && pwd)" || return
    case "$real_state" in
        "$real_root"/*) ;;
        *) return ;;
    esac
    if [ -L "$state/events.ndjson" ]; then return; fi
    printf '{"ts":"%s","tool":"gate-run","kind":"gate-error","result":"allowed"}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$state/events.ndjson" 2>/dev/null
}

# The CLI runs in the background so this script can end it when Claude Code ends this hook (its
# timeout): a TERM, INT or HUP here ends the CLI too. `<&0` keeps the hook input on its stdin.
CHILD=""
OUT_FILE="$(mktemp "${TMPDIR:-/tmp}/oss-gate-run.XXXXXX" 2>/dev/null)" || OUT_FILE=""
end_check() {
    if [ -n "$CHILD" ]; then kill -TERM "$CHILD" 2>/dev/null; fi
    if [ -n "$OUT_FILE" ]; then rm -f "$OUT_FILE"; fi
    exit 143
}
trap end_check TERM INT HUP

if [ -n "$OUT_FILE" ]; then
    node "$CLI" "$EVENT" <&0 >"$OUT_FILE" &
    CHILD=$!
    wait "$CHILD"
    RC=$?
    OUT="$(cat "$OUT_FILE")"
    rm -f "$OUT_FILE"
else
    OUT="$(node "$CLI" "$EVENT")"
    RC=$?
fi

if [ "$RC" = 0 ]; then
    if [ -n "$OUT" ]; then printf '%s\n' "$OUT"; fi
    exit 0
fi

log_gate_error
printf '{"systemMessage":"OSS review check could not run, so this review run is unverified: the repo may have changed while it ran."}\n'
exit 0
