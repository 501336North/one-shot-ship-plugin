#!/bin/bash
# oss-tool-gate.sh pre|post - runs the tool gate on a Claude Code tool call (hook JSON on stdin).
#
# Registered in hooks.json: PreToolUse (Bash|Edit|Write|MultiEdit|NotebookEdit) → pre,
# PostToolUse / PostToolUseFailure (Bash) → post.
#
# The gate's answer is returned as is: exit 0 with its stdout (allow), exit 2 with its stderr (refuse).
# Any other outcome (another exit code, a missing CLI, no node, a killed process) means the gate
# itself failed: the call is allowed, the agent is told, and one fixed gate-error line is logged
# (ADR-005). Never prints a permissionDecision. Nothing from the hook input is read here: stdin goes
# straight to the gate, so no input text reaches a command or the log line.
set -u

MODE="${1:-}"
EVENT=PreToolUse
[ "$MODE" = post ] && EVENT=PostToolUse

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" 2>/dev/null && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"
CLI="$PLUGIN_ROOT/watcher/dist/cli/tool-gate.cjs"

# The project folder, as the gate finds it: CLAUDE_PROJECT_DIR when it is an existing absolute
# folder, else the nearest folder holding .git at or above this hook's folder, else this folder.
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

# Appends one gate-error line to <project>/.oss/tool-gates/events.ndjson, the gate's own event log.
# Like the gate's state store, it refuses a symlinked .oss, .oss/tool-gates or events.ndjson, and a
# state folder that resolves outside the project. Best effort: the call is allowed either way.
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
    printf '{"ts":"%s","tool":"unknown","kind":"gate-error","result":"allowed"}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$state/events.ndjson" 2>/dev/null
}

OUT="$(node "$CLI" "$MODE")"
RC=$?

case "$RC" in
    0)
        if [ -n "$OUT" ]; then printf '%s\n' "$OUT"; fi
        exit 0
        ;;
    2)
        exit 2
        ;;
esac

log_gate_error
printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"tool-gate failed, rules not checked."}}\n' "$EVENT"
exit 0
