#!/bin/bash
# oss-gate-run.sh subagent-start|subagent-stop|agent-post|main-post - the review-run check (R-266,
# ADR-009), hook JSON on stdin.
# oss-gate-run.sh add-repo - names one more repo for this session's review runs: the path the main agent
# wrote to ~/.oss/gate-state/<session>/repo-request.txt. Never a path on the command line. Since round 14 C
# (D-R14-3) config/tool-gates.json protects ~/.oss/gate-state/**, so an agent's own Write there is refused:
# the path reaches the CLI on stdin through oss-value.sh review-repo instead.
#
# Registered in hooks.json: SubagentStart → subagent-start, SubagentStop → subagent-stop,
# PostToolUse (Agent|Task) → agent-post, PostToolUse (every tool) → main-post. Not async: the check's
# answer is hook output.
#
# main-post runs on every tool call, so it ends here, without starting node, when no notice is pending
# in this session's folder of ~/.oss/gate-state (a glob test, no subprocess). The session is the hook
# input's session_id (Claude Code writes it first: only the first 1 KB is read, by the bash builtin),
# else CLAUDE_CODE_SESSION_ID; a plain id only. With neither, node never starts.
#
# The check's answer is returned as is (exit 0 with its stdout). Any other outcome (a non-zero exit, a
# missing CLI, no usable node, this hook stopped at its time limit) means the check itself failed: the
# run is allowed, the user is told the review is unverified, and for a review (gate) agent, or one the
# hook cannot tell is not, a notice is kept for the main agent in the session's folder, as the CLI does
# (sec MEDIUM-3). With no usable node a builder agent's run says nothing (the CLI would not check it),
# and the main agent's next tool call (or Agent result) is told by this hook itself that the pending
# review runs are unverified. Whether an agent is a review agent is read from the plugin's
# config/tool-gates.json gateAgents and any the nearest repo's .oss/tool-gates.json adds; an unreadable
# plugin list counts every agent as one. Logging is left to the CLI. Nothing from the hook input
# reaches a command: only plain ids (and the cwd, as a path to test) are matched in its head.
# add-repo's answer and exit code pass through as they are.
#
# node comes from ~/.oss/node-path (recorded on first use when missing; never PATH's: oss-node.sh), and
# every other program from a fixed path (oss-node.sh's OSS_*), never through PATH (security C1, CR L1).
set -u

EVENT="${1:-}"
CHECK_FAILED_TEXT='OSS review check could not run, so this review run is unverified: the repo may have changed while it ran.'
CHECK_FAILED='{"systemMessage":"'"$CHECK_FAILED_TEXT"'"}'
# The reasons kept in notices are the CLI's own (watcher/src/gate-run/messages.ts REASONS).
REASON_NO_NODE='the review check has no usable node'
REASON_CHECK_FAILED='the check failed'
NO_NODE_CONTEXT="This review's report is unverified: OSS could not check whether the repo changed while the review ran ($REASON_NO_NODE).\\nTreat the review's report as unverified: stop the ship and ask the user how to go on before acting on this review."

HEAD=""
SESSION=""
case "$EVENT" in
    main-post|agent-post) LC_ALL=C IFS= read -r -d '' -n 1024 HEAD ;;
    subagent-start|subagent-stop) LC_ALL=C IFS= read -r -d '' -n 65536 HEAD ;;
esac
if [[ "$HEAD" =~ \"session_id\"[[:space:]]*:[[:space:]]*\"([A-Za-z0-9_-]{1,128})\" ]]; then
    SESSION="${BASH_REMATCH[1]}"
elif [[ "${CLAUDE_CODE_SESSION_ID:-}" =~ ^[A-Za-z0-9_-]{1,128}$ ]]; then
    SESSION="$CLAUDE_CODE_SESSION_ID"
fi
if [ "$EVENT" = main-post ]; then
    if [ -z "$SESSION" ]; then exit 0; fi
    shopt -s nullglob
    pending=("${HOME:-/nonexistent}/.oss/gate-state/$SESSION"/*.notice.json)   # oss-node.sh oss_gate_state_dir
    if [ "${#pending[@]}" = 0 ]; then exit 0; fi
fi

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" 2>/dev/null && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"
# The gate list comes from CLAUDE_PLUGIN_ROOT: always the plugin's root, never the working folder.
export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
CLI="$PLUGIN_ROOT/watcher/dist/cli/gate-run.cjs"

if [ ! -f "$SCRIPT_DIR/oss-node.sh" ]; then
    # No helpers: no fixed programs to keep a notice with. The user is still told.
    if [ "$EVENT" = add-repo ]; then printf 'OSS add-repo: the plugin is missing hooks/oss-node.sh\n' >&2; exit 1; fi
    printf '%s\n' "$CHECK_FAILED"
    exit 0
fi
source "$SCRIPT_DIR/oss-node.sh"
OSS_NODE=""
oss_node || OSS_NODE=""

# The plain value of "key":"value" in the input's head (ids and agent names only), else empty.
head_value() {
    local re="\"$1\"[[:space:]]*:[[:space:]]*\"([A-Za-z0-9_.:-]{1,128})\""
    if [[ "$HEAD" =~ $re ]]; then printf '%s' "${BASH_REMATCH[1]}"; fi
}
AGENT="$(head_value agent_id)"
AGENT_TYPE="$(head_value agent_type)"

# True when the file's gateAgents list names the agent (bare, lower case). 2 when the list cannot be read.
lists_agent() { # file bare
    local text="" re='"gateAgents"[[:space:]]*:[[:space:]]*\[([^]]*)\]' names
    [ -f "$1" ] && [ ! -L "$1" ] || return 2
    IFS= read -r -d '' text < "$1"
    [[ "$text" =~ $re ]] || return 2
    names="$(printf '%s' "${BASH_REMATCH[1]}" | "$OSS_TR" '[:upper:]' '[:lower:]')"
    case "$names" in *\""$2"\"*) return 0 ;; esac
    return 1
}

# The nearest folder at or above the path holding .git (builtins only), else empty.
nearest_repo() {
    local d="$1"
    case "$d" in /*) ;; *) return 0 ;; esac
    while [ -n "$d" ]; do
        if [ -e "$d/.git" ]; then printf '%s' "$d"; return 0; fi
        d="${d%/*}"
    done
}

# True when the agent is a review (gate) agent, or the hook cannot tell it is not (fail closed).
review_agent() {
    local bare repo cwd="" rc
    [ -n "$AGENT_TYPE" ] || return 0
    bare="${AGENT_TYPE##*:}"
    bare="$(printf '%s' "$bare" | "$OSS_TR" '[:upper:]' '[:lower:]')"
    lists_agent "$PLUGIN_ROOT/config/tool-gates.json" "$bare"; rc=$?
    [ "$rc" = 1 ] || return 0
    if [[ "$HEAD" =~ \"cwd\"[[:space:]]*:[[:space:]]*\"([^\"\\]{1,4096})\" ]]; then cwd="${BASH_REMATCH[1]}"; fi
    for repo in "$(nearest_repo "${CLAUDE_PROJECT_DIR:-}")" "$(nearest_repo "$cwd")"; do
        [ -n "$repo" ] && lists_agent "$repo/.oss/tool-gates.json" "$bare" && return 0
    done
    return 1
}

# Keeps an unverified notice (reason) for the main agent, as the CLI does: in the session's private
# folder (no folder a symlink, 0700; the file 0600, never over an existing one), with the run's ledger
# mark (started / done) so the CLI knows the run. Best effort.
keep_notice() { # reason
    case "$EVENT" in subagent-start|subagent-stop) ;; *) return 0 ;; esac
    [[ "$SESSION" =~ ^[A-Za-z0-9_-]{1,128}$ && "$AGENT" =~ ^[A-Za-z0-9_-]{1,128}$ ]] || return 0
    case "${HOME:-}" in /*) ;; *) return 0 ;; esac
    (
        umask 077
        dir="$(oss_gate_state_dir "$SESSION")" || exit 1
        set -C
        printf '{"kind":"unverified","reason":"%s"}' "$1" > "$dir/$AGENT.$("$OSS_DATE" +%s)-$$-$RANDOM.notice.json" || exit 1
        if [ "$EVENT" = subagent-start ]; then
            "$OSS_RM" -f "$dir/$AGENT.done"
            [ -e "$dir/$AGENT.started" ] || : > "$dir/$AGENT.started"
        else
            [ -e "$dir/$AGENT.done" ] || : > "$dir/$AGENT.done"
        fi
    ) 2>/dev/null
    return 0
}

if [ "$EVENT" = add-repo ]; then
    if [ -z "$OSS_NODE" ]; then
        printf 'OSS add-repo: no usable node recorded in ~/.oss/node-path (start a new Claude session to record it)\n' >&2
        exit 1
    fi
    exec "$OSS_NODE" "$CLI" add-repo </dev/null
fi

if [ -z "$OSS_NODE" ]; then
    case "$EVENT" in
        subagent-start|subagent-stop)
            review_agent || exit 0
            keep_notice "$REASON_NO_NODE"
            if [ "${OSS_NODE_PROBLEM:-}" = changed ]; then
                printf '{"systemMessage":"%s %s"}\n' "$CHECK_FAILED_TEXT" "$(oss_json_text "$(oss_node_changed_message)")"
            else
                printf '%s\n' "$CHECK_FAILED"
            fi
            ;;
        main-post|agent-post)
            # The CLI cannot hand out the pending notices: take them here and tell the main agent once.
            [ -n "$SESSION" ] || exit 0
            dir="${HOME:-/nonexistent}/.oss/gate-state/$SESSION"
            shopt -s nullglob
            pending=("$dir"/*.notice.json)
            [ "${#pending[@]}" = 0 ] && exit 0
            if [ ! -L "$dir" ] && [ ! -L "${dir%/*}" ]; then "$OSS_RM" -f "${pending[@]}"; fi
            printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$NO_NODE_CONTEXT"
            ;;
        *) printf '%s\n' "$CHECK_FAILED" ;;
    esac
    exit 0
fi

# The check itself failed: the user is told, and a review agent's run is kept unverified for the main agent.
check_failed() {
    review_agent && keep_notice "$REASON_CHECK_FAILED"
    printf '%s\n' "$CHECK_FAILED"
    exit 0
}

# Where the CLI's answer is kept until it ends: ~/.oss/gate-state (oss_gate_state_dir: 0700, no folder on the way a
# symlink), which a review agent can't write, as oss-tool-gate.sh's out_file. Never TMPDIR, which a
# review agent can (round 9, CR HIGH-1): with no such folder the CLI runs in the foreground instead.
out_file() {
    local d
    d="$(oss_gate_state_dir)" || return 1
    "$OSS_MKTEMP" "$d/out.XXXXXX" 2>/dev/null
}

# The CLI runs in the background so this script can end it when Claude Code ends this hook (its
# timeout): a TERM, INT or HUP here ends the CLI too, and the user is told the run is unverified.
# The hook input goes on its stdin (the head already read, then the rest).
CHILD=""
OUT_FILE="$(out_file)" || OUT_FILE=""
end_check() {
    if [ -n "$CHILD" ]; then kill -TERM "$CHILD" 2>/dev/null; fi
    if [ -n "$OUT_FILE" ]; then "$OSS_RM" -f "$OUT_FILE"; fi
    check_failed
}
trap end_check TERM INT HUP

if [ -n "$OUT_FILE" ]; then
    { printf '%s' "$HEAD"; "$OSS_CAT"; } | "$OSS_NODE" "$CLI" "$EVENT" >"$OUT_FILE" &
    CHILD=$!
    wait "$CHILD"
    RC=$?
    OUT="$("$OSS_CAT" "$OUT_FILE")"
    "$OSS_RM" -f "$OUT_FILE"
else
    OUT="$({ printf '%s' "$HEAD"; "$OSS_CAT"; } | "$OSS_NODE" "$CLI" "$EVENT")"
    RC=$?
fi

if [ "$RC" = 0 ]; then
    if [ -n "$OUT" ]; then printf '%s\n' "$OUT"; fi
    exit 0
fi

check_failed
