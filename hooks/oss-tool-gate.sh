#!/bin/bash
# oss-tool-gate.sh pre|post - runs the tool gate on a Claude Code tool call (hook JSON on stdin).
#
# Registered in hooks.json: PreToolUse (Bash|Edit|Write|MultiEdit|NotebookEdit|Monitor|Read|Grep|Glob)
# → pre, PostToolUse / PostToolUseFailure (Bash) → post.
#
# The gate's answer is returned as is: exit 0 with its stdout (allow; for a review agent on macOS the
# call rewritten to run in the review sandbox, with permissionDecision allow), exit 2 with its stderr
# (refuse). A gate still running at this hook's own deadline is ended, and the pre call refused as too
# complex to check in time, whoever made it (round 9, D-R9-4). Any other outcome (another exit code, a
# missing CLI, no node, a killed process) means the gate itself failed: one fixed gate-error line is
# logged, and
#   - a review agent's pre call (agent_type on the GATE_AGENTS list) is refused (exit 2): a review
#     call that can't be checked could change what it judges (round 6 choice 1, round 8 M4);
#   - any other call is allowed and the agent is told (ADR-005).
# node is the absolute path in ~/.oss/node-path (oss-node.sh records PATH's node on first use, and never
# switches to a different one on its own: OSS_NODE_PROBLEM=changed, which the user is told about). cat,
# mktemp, rm, mkdir, date and tr are oss-node.sh's fixed paths (OSS_CAT …), sleep is /bin/sleep: never
# through PATH, where a review agent could place a fake one (security C1, L1).
# Hook input is read only to find agent_type and tool_name (bash regex, never run or logged); the rest
# goes to the gate. A Read, Grep or Glob call certainly not a review agent's is allowed without
# starting node (round 10, PERF MEDIUM-2).
set -u

MODE="${1:-}"
EVENT=PreToolUse
[ "$MODE" = post ] && EVENT=PostToolUse

# The review agents (config/tool-gates.json gateAgents; a test keeps the two the same).
GATE_AGENTS=" code-reviewer security-auditor penetration-tester performance-auditor "
# Seconds the gate may run before this hook ends it: above the gate's own 2.5 s hard limit, and well
# below Claude Code's 15 s hook timeout (hooks.json), so this hook, not Claude Code, decides a call
# that runs out of time, however long the hook took to start (round 9, SEC LOW-1).
DEADLINE_SECONDS=4
# The answer to a call the gate could not check in time (watcher/src/tool-gate/deadline.ts TIMED_OUT_REFUSAL).
TIMED_OUT_REFUSAL='Refused by the tool gate: this command is too complex to check in time; split it into simpler commands.'

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" 2>/dev/null && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"
# The gate reads its base rules from CLAUDE_PLUGIN_ROOT: always hand it the plugin's root, never
# leave it unset (the base rules must not come from the working folder, which the repo controls).
export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
CLI="$PLUGIN_ROOT/watcher/dist/cli/tool-gate.cjs"
# The fixed programs, as oss-node.sh sets them (these first, for a plugin without it).
OSS_CAT=/bin/cat OSS_MKTEMP=/usr/bin/mktemp OSS_RM=/bin/rm OSS_MKDIR=/bin/mkdir OSS_DATE=/bin/date OSS_TR=/usr/bin/tr

# The whole hook input (JSON holds no NUL byte). The trailing x keeps a final newline.
HOOK_INPUT="$("$OSS_CAT"; printf x)"
HOOK_INPUT="${HOOK_INPUT%x}"

# True when the call is a review agent's: an agent_type naming a GATE_AGENTS entry (`oss:` prefix and
# letter case ignored), two or more agent_type keys (no real call has two: fail closed), or an agent_id
# with no agent_type the hook can read. A `"agent_type"` key can't appear inside a JSON string (its
# quotes would be escaped), so every match is a real key. The answer is worked out once, with two
# regex matches over the input and no fork, so any input is read in linear time (round 9, PERF
# MEDIUM-1; round 11, PERF LOW-2).
REVIEW_AGENT=""
review_agent_answer() {
    local name
    REVIEW_AGENT=no
    if [[ "$HOOK_INPUT" =~ \"agent_type\".*\"agent_type\" ]]; then
        REVIEW_AGENT=yes
    elif [[ "$HOOK_INPUT" =~ \"agent_type\"[[:space:]]*:[[:space:]]*\"([^\"\\]*)\" ]]; then
        name="${BASH_REMATCH[1]}"
        shopt -s nocasematch
        case "$GATE_AGENTS" in *" ${name##*:} "*) REVIEW_AGENT=yes ;; esac
        shopt -u nocasematch
    elif [[ "$HOOK_INPUT" =~ \"agent_id\"[[:space:]]*: ]]; then
        REVIEW_AGENT=yes
    fi
}
is_review_agent() {
    [ -n "$REVIEW_AGENT" ] || review_agent_answer
    [ "$REVIEW_AGENT" = yes ]
}

# True when the call is certainly a Read, Grep or Glob call of the main agent or a builder: exactly
# one tool_name key, naming one of the three as plain text; at most one agent_type key, a plain name
# that is not a review agent's; no agent_id without an agent_type. Anything else (an escaped or
# repeated key, a value that is not a plain string) is not certain, and goes to the gate (fail
# closed). No process is forked (round 10, PERF MEDIUM-2).
is_others_read() {
    [ "$MODE" = pre ] || return 1
    [[ "$HOOK_INPUT" =~ \"tool_name\"[[:space:]]*:[[:space:]]*\"(Read|Grep|Glob)\"[[:space:]]*[,}] ]] || return 1
    if [[ "$HOOK_INPUT" =~ \"tool_name\".*\"tool_name\" ]]; then return 1; fi
    if [[ "$HOOK_INPUT" =~ \"agent_type\" ]]; then
        if [[ "$HOOK_INPUT" =~ \"agent_type\".*\"agent_type\" ]]; then return 1; fi
        [[ "$HOOK_INPUT" =~ \"agent_type\"[[:space:]]*:[[:space:]]*\"[A-Za-z0-9_.:-]+\"[[:space:]]*[,}] ]] || return 1
    elif [[ "$HOOK_INPUT" =~ \"agent_id\" ]]; then
        return 1
    fi
    ! is_review_agent
}

# The main agent's and builders' reads have no rule to check: allowed without starting node (+90 ms).
if is_others_read; then exit 0; fi

OSS_NODE=""
OSS_NODE_PROBLEM=""
if [ -f "$SCRIPT_DIR/oss-node.sh" ]; then
    source "$SCRIPT_DIR/oss-node.sh"
    oss_node || OSS_NODE=""
fi

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
# Like the gate's state store, it refuses a symlinked .oss, .oss/tool-gates or events.ndjson, a
# state folder that resolves outside the project, and a log that is not a regular file (a named pipe
# would block the write). Best effort: the answer is the same either way.
log_gate_error() {
    local result="$1" root state real_state real_root log
    root="$(project_root)"
    state="$root/.oss/tool-gates"
    log="$state/events.ndjson"
    if [ -L "$root/.oss" ] || [ -L "$state" ]; then return; fi
    "$OSS_MKDIR" -p "$state" 2>/dev/null || return
    real_state="$(cd -P "$state" 2>/dev/null && pwd)" || return
    real_root="$(cd -P "$root" 2>/dev/null && pwd)" || return
    case "$real_state" in
        "$real_root"/*) ;;
        *) return ;;
    esac
    if [ -L "$log" ]; then return; fi
    if [ -e "$log" ] && { [ ! -f "$log" ] || [ -p "$log" ]; }; then return; fi
    printf '{"ts":"%s","tool":"unknown","kind":"gate-error","result":"%s"}\n' \
        "$("$OSS_DATE" -u +%Y-%m-%dT%H:%M:%SZ)" "$result" >> "$log" 2>/dev/null
}

# One plain id (`[A-Za-z0-9_-]{1,128}`) the hook input gives under the key $1, in ID; false when there
# is none, or the key appears twice (no real call has two: nothing is marked).
plain_id() {
    ID=""
    if [[ "$HOOK_INPUT" =~ \"$1\".*\"$1\" ]]; then return 1; fi
    [[ "$HOOK_INPUT" =~ \"$1\"[[:space:]]*:[[:space:]]*\"([A-Za-z0-9_-]{1,128})\"[[:space:]]*[,}] ]] || return 1
    ID="${BASH_REMATCH[1]}"
}

# A review agent's post call the gate could not finish may have swapped the code under review: the run
# is void (round 14, SEC LOW-2 / PERF INFO-C). Its tamper mark is written where and as the CLI writes it
# (watcher/src/gate-run/run-store.ts mark()): ~/.oss/gate-state/<session_id>/<agent_id>.tamper (oss-node.sh
# oss_gate_state_dir), each folder 0700 and never a link, the file 0600 holding the time. Best effort, in a subshell.
void_review_run() {
    [ "$MODE" = post ] || return 0
    is_review_agent || return 0
    local session agent
    plain_id session_id || return 0
    session="$ID"
    plain_id agent_id || return 0
    agent="$ID"
    case "${HOME:-}" in /*) ;; *) return 0 ;; esac
    (
        umask 077
        declare -F oss_gate_state_dir >/dev/null || exit 1
        dir="$(oss_gate_state_dir "$session")" || exit 1
        # a link or anything but a file in its place is removed first; never written through
        if [ -L "$dir/$agent.tamper" ] || { [ -e "$dir/$agent.tamper" ] && [ ! -f "$dir/$agent.tamper" ]; }; then
            "$OSS_RM" -f "$dir/$agent.tamper" 2>/dev/null || exit 1
        fi
        [ -f "$dir/$agent.tamper" ] && exit 0
        set -C
        printf '%s\n' "$("$OSS_DATE" -u +%Y-%m-%dT%H:%M:%SZ)" > "$dir/$agent.tamper"
    ) 2>/dev/null
    return 0
}

# The gate could not answer ($1 says why; $2, when given, is a message for the user): refuse a review
# agent's pre call, allow and tell the rest; a review agent's post call voids its run.
gate_failed() {
    local note="${2:-}"
    void_review_run
    if [ "$MODE" = pre ] && is_review_agent; then
        log_gate_error refused
        printf 'Refused by gate-agent-write: the tool gate could not run (%s), and a review agent'"'"'s call that can'"'"'t be checked is refused. Report what you need to the main agent.\n' "$1" >&2
        if [ -n "$note" ]; then printf '%s\n' "$note" >&2; fi
        exit 2
    fi
    log_gate_error allowed
    if [ -n "$note" ]; then
        printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"%s","additionalContext":"tool-gate failed, rules not checked. %s"}}\n' \
            "$(oss_json_text "$note")" "$EVENT" "$(oss_json_text "$note")"
    else
        printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"tool-gate failed, rules not checked."}}\n' "$EVENT"
    fi
    exit 0
}

# Where the gate's answer is kept until it ends: the gate's own state folder ~/.oss/gate-state (oss-node.sh
# oss_gate_state_dir: 0700, no folder on the way a symlink), which config/tool-gates.json keeps every
# agent out of (round 15, CR I2: never ~/.oss/run, which the main agent and builders can write). Never
# TMPDIR, which a review agent can write (round 10, SEC INFO-2): with no such folder the gate runs in
# the foreground.
out_file() {
    local dir
    declare -F oss_gate_state_dir >/dev/null || return 1
    dir="$(oss_gate_state_dir)" || return 1
    "$OSS_MKTEMP" "$dir/out.XXXXXX" 2>/dev/null
}

if [ -z "$OSS_NODE" ]; then
    # No usable ~/.oss/node-path: never fall back to PATH's node.
    if [ "${OSS_NODE_PROBLEM:-}" = changed ] && declare -F oss_node_changed_message >/dev/null; then
        gate_failed "the recorded node changed" "$(oss_node_changed_message)"
    fi
    gate_failed "no recorded node"
fi

# The gate runs in the background so this script can end it: at this hook's own deadline, or when
# Claude Code ends this hook (a TERM, INT or HUP here ends the gate too, instead of leaving node
# running). The gate also ends itself at its own hard limit, which covers a KILL that no trap sees.
# On macOS a review agent's Bash call runs in the review sandbox: the gate's allow must carry the call
# rewritten (updatedInput), or the gate's own reason it runs outside the sandbox (its setup step, the
# host's sandbox); OSS_TOOL_GATE_SANDBOX=off in this hook's environment turns the sandbox off. A bare
# allow is refused (round 10, SEC INFO-1). A tool_name the hook can't read as one plain name other than
# Bash counts as Bash (fail closed).
# The gate's whole answer for a call it allows outside the sandbox (gate.ts OUTSIDE_SANDBOX_NOTE), and
# the start of its answer for a call rewritten to run inside it: matched as the whole answer and as
# its start, never as text anywhere in it, so a path or command echoed into the answer can't pass.
UNSANDBOXED_ANSWER='{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"This command runs outside the review sandbox."}}'
WRAPPED_START='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{'
UNSANDBOXED_REFUSAL='Refused by gate-agent-write: the tool gate allowed this review agent'"'"'s command without the review sandbox and gave no reason. Report what you need to the main agent.'
sandbox_answer_ok() {
    [ "$MODE" = pre ] || return 0
    case "${OSTYPE:-}" in darwin*) ;; *) return 0 ;; esac
    [ "${OSS_TOOL_GATE_SANDBOX:-}" = off ] && return 0
    is_review_agent || return 0
    if [[ "$HOOK_INPUT" =~ \"tool_name\"[[:space:]]*:[[:space:]]*\"([A-Za-z]+)\"[[:space:]]*[,}] ]] &&
        [ "${BASH_REMATCH[1]}" != Bash ] && ! [[ "$HOOK_INPUT" =~ \"tool_name\".*\"tool_name\" ]]; then
        return 0
    fi
    [ "$OUT" = "$UNSANDBOXED_ANSWER" ] && return 0
    [ "${OUT:0:${#WRAPPED_START}}" = "$WRAPPED_START" ] && return 0
    return 1
}

CHILD=""
WATCHDOG=""
OUT_FILE="$(out_file)" || OUT_FILE=""
end_gate() {
    if [ -n "$CHILD" ]; then kill -TERM "$CHILD" 2>/dev/null; fi
    if [ -n "$WATCHDOG" ]; then kill -TERM "$WATCHDOG" 2>/dev/null; fi
    if [ -n "$OUT_FILE" ]; then "$OSS_RM" -f "$OUT_FILE"; fi
    void_review_run
    exit 143
}
trap end_gate TERM INT HUP

if [ -n "$OUT_FILE" ]; then
    printf '%s' "$HOOK_INPUT" | "$OSS_NODE" "$CLI" "$MODE" >"$OUT_FILE" &
    CHILD=$!
    # The deadline timer: its sleep ends with it (TERM), so none is left behind (round 9, CR INFO-1).
    (
        trap 'kill "$!" 2>/dev/null; exit 0' TERM
        /bin/sleep "$DEADLINE_SECONDS" &
        wait "$!"
        kill -TERM "$CHILD" 2>/dev/null
    ) >/dev/null 2>&1 &
    WATCHDOG=$!
    wait "$CHILD"
    RC=$?
    kill -TERM "$WATCHDOG" 2>/dev/null
    OUT="$("$OSS_CAT" "$OUT_FILE")"
    "$OSS_RM" -f "$OUT_FILE"
else
    # No answer file (no usable folder under ~/.oss, mktemp missing or failing): run in the foreground.
    OUT="$(printf '%s' "$HOOK_INPUT" | "$OSS_NODE" "$CLI" "$MODE")"
    RC=$?
fi

case "$RC" in
    0)
        if ! sandbox_answer_ok; then
            log_gate_error refused
            printf '%s\n' "$UNSANDBOXED_REFUSAL" >&2
            exit 2
        fi
        if [ -n "$OUT" ]; then printf '%s\n' "$OUT"; fi
        exit 0
        ;;
    2)
        exit 2
        ;;
    143)
        # Ended at this hook's deadline: too complex to check in time, refused for every agent (D-R9-4).
        if [ "$MODE" = pre ] && [ -n "$WATCHDOG" ]; then
            log_gate_error refused
            printf '%s\n' "$TIMED_OUT_REFUSAL" >&2
            exit 2
        fi
        ;;
esac

gate_failed "it did not answer"
