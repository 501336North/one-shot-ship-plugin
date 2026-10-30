#!/bin/bash
# oss-notify.sh - Unified notification hook for OSS Dev Workflow
#
# Usage (direct):
#   oss-notify.sh "Title" "Message"
#
# Usage (with copy service):
#   oss-notify.sh --workflow <command> <event> [context-json]
#   oss-notify.sh --session <event> [context-json]
#   oss-notify.sh --issue <type> [context-json]
#
# Respects settings from ~/.oss/settings.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/oss-api-curl.sh" ]]; then source "$SCRIPT_DIR/oss-api-curl.sh"; fi  # oss_api_curl: API key via stdin, never argv
if [[ -f "$SCRIPT_DIR/oss-safe-path.sh" ]]; then source "$SCRIPT_DIR/oss-safe-path.sh"; else oss_safe_mkdir() { return 1; }; oss_safe_target() { return 1; }; oss_valid_workflow_name() { return 1; }; oss_refuse_unsafe() { echo "oss: refusing unsafe .oss path ${1:-} (oss-safe-path.sh missing)" >&2; }; fi  # oss_valid_workflow_name (fail closed if absent)
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"

# =============================================================================
# TIMEOUT WRAPPER - Prevents blocking on slow/hanging node calls
# Keeps the command's stderr: each caller redirects it (F6: chain-trigger's goes to its log).
# =============================================================================
run_with_timeout() {
    local timeout_secs="${1:-2}"
    shift
    if command -v gtimeout &>/dev/null; then
        gtimeout "$timeout_secs" "$@" || true
    elif command -v timeout &>/dev/null; then
        timeout "$timeout_secs" "$@" || true
    else
        "$@" &
        local pid=$!
        # The timer holds no stdio, and killing it also kills its sleep (R2-1; same shape as oss-session-start.sh).
        ( trap 'kill $s 2>/dev/null; exit 0' TERM; sleep "$timeout_secs" & s=$!; wait $s && kill -9 $pid 2>/dev/null ) </dev/null >/dev/null 2>&1 &
        local killer=$!
        wait $pid 2>/dev/null || true
        kill $killer 2>/dev/null || true
        wait $killer 2>/dev/null || true
    fi
}

# =============================================================================
# CLI PATH RESOLUTION - Version-agnostic lookup with plugin cache fallback
# =============================================================================
# Priority 1: CLAUDE_PLUGIN_ROOT (set by Claude Code hook system)
# Priority 2: find in ~/.claude/plugins/cache/ (fallback for command prompts)
resolve_cli() {
    local cli_name="$1"
    local cli_subpath="$2"
    # Try PLUGIN_ROOT first
    local direct_path="$PLUGIN_ROOT/$cli_subpath"
    if [[ -f "$direct_path" ]]; then
        echo "$direct_path"
        return
    fi
    # Fallback: search plugin cache (version-agnostic)
    local found
    found=$(find "$HOME/.claude/plugins/cache/one-shot-ship-plugin" -name "$cli_name" -path "*/$cli_subpath" -type f 2>/dev/null | sort -V | tail -1)
    if [[ -n "$found" ]]; then
        echo "$found"
        return
    fi
    # Last resort: return the direct path (will fail gracefully)
    echo "$direct_path"
}

COPY_CLI="$(resolve_cli "get-copy.js" "watcher/dist/cli/get-copy.js")"
WORKFLOW_STATE_CLI="$(resolve_cli "update-workflow-state.js" "watcher/dist/cli/update-workflow-state.js")"
# Prefer bundled .cjs (standalone, no external imports) over .js (needs api/engine deps)
CHAIN_TRIGGER_CLI="$(resolve_cli "chain-trigger.cjs" "watcher/dist/cli/chain-trigger.cjs")"
if [[ ! -f "$CHAIN_TRIGGER_CLI" ]]; then
    CHAIN_TRIGGER_CLI="$(resolve_cli "chain-trigger.js" "watcher/dist/cli/chain-trigger.js")"
fi

# =============================================================================
# PROJECT DIRECTORY RESOLUTION - For multi-project workflow state isolation
# =============================================================================
# Resolve project directory so workflow state writes go to the correct
# project-local file (not the global ~/.oss/workflow-state.json).
# Resolution: oss_resolve_project (hooks/oss-safe-path.sh), the one rule for every model-run script.
_OSS_PROJ=""
declare -F oss_resolve_project >/dev/null && oss_resolve_project
_OSS_PROJECT_DIR="$_OSS_PROJ"

# Helper: call update-workflow-state.js with --project-dir when available
# Usage: wf_state <command> [args...]
wf_state() {
    if [[ -n "$_OSS_PROJECT_DIR" && -d "$_OSS_PROJECT_DIR/.oss" ]]; then
        node "$WORKFLOW_STATE_CLI" --project-dir "$_OSS_PROJECT_DIR" "$@"
    else
        node "$WORKFLOW_STATE_CLI" "$@"
    fi
}

# Helper: call wf_state with timeout wrapper
wf_state_timeout() {
    local timeout_secs="$1"
    shift
    if [[ -n "$_OSS_PROJECT_DIR" && -d "$_OSS_PROJECT_DIR/.oss" ]]; then
        run_with_timeout "$timeout_secs" node "$WORKFLOW_STATE_CLI" --project-dir "$_OSS_PROJECT_DIR" "$@"
    else
        run_with_timeout "$timeout_secs" node "$WORKFLOW_STATE_CLI" "$@"
    fi
}

LOG_SCRIPT="$PLUGIN_ROOT/hooks/oss-log.sh"
# LOG_SCRIPT fallback: check plugin cache if not found at PLUGIN_ROOT
if [[ ! -f "$LOG_SCRIPT" ]]; then
    _found_log=$(find "$HOME/.claude/plugins/cache/one-shot-ship-plugin" -name "oss-log.sh" -path "*/hooks/*" -type f 2>/dev/null | sort -V | tail -1 || true)
    [[ -n "$_found_log" ]] && LOG_SCRIPT="$_found_log"
fi

# =============================================================================
# Parse arguments
# =============================================================================

USE_COPY_SERVICE=false
COPY_TYPE=""
COPY_ARGS=()
TITLE=""
MESSAGE=""
SUBTITLE=""

if [[ "${1:-}" == "--workflow" ]]; then
    USE_COPY_SERVICE=true
    COPY_TYPE="workflow"
    COPY_ARGS=("${@:2}")
    CMD="${2:-}"
    # The name reaches file paths (oss-log.sh <name>.log), analytics JSON and chain-trigger:
    # anything but a plain command name (e.g. build/../ship) is refused before any of them.
    if ! oss_valid_workflow_name "$CMD" 2>/dev/null; then
        echo "oss-notify: invalid workflow name refused (must match ^[a-z][a-z0-9-]{0,40}\$)" >&2
        exit 0
    fi
elif [[ "${1:-}" == "--session" ]]; then
    USE_COPY_SERVICE=true
    COPY_TYPE="session"
    COPY_ARGS=("${@:2}")
elif [[ "${1:-}" == "--issue" ]]; then
    USE_COPY_SERVICE=true
    COPY_TYPE="issue"
    COPY_ARGS=("${@:2}")
else
    # Direct usage: oss-notify.sh "Title" "Message"
    TITLE="${1:-Notification}"
    MESSAGE="${2:-}"
fi

# =============================================================================
# Get copy from service if requested
# =============================================================================

if [[ "$USE_COPY_SERVICE" == true ]] && [[ -f "$COPY_CLI" ]]; then
    # Call copy service CLI (with timeout to prevent hanging)
    COPY_JSON=$(run_with_timeout 3 node "$COPY_CLI" "$COPY_TYPE" "${COPY_ARGS[@]}" 2>/dev/null || echo '{}')

    if command -v jq &>/dev/null; then
        TITLE=$(echo "$COPY_JSON" | jq -r '.title // "OSS"')
        MESSAGE=$(echo "$COPY_JSON" | jq -r '.message // ""')
        SUBTITLE=$(echo "$COPY_JSON" | jq -r '.subtitle // ""')
    else
        # Fallback parsing
        TITLE=$(echo "$COPY_JSON" | grep -o '"title":"[^"]*"' | cut -d'"' -f4 || echo "OSS")
        MESSAGE=$(echo "$COPY_JSON" | grep -o '"message":"[^"]*"' | cut -d'"' -f4 || echo "")
        SUBTITLE=$(echo "$COPY_JSON" | grep -o '"subtitle":"[^"]*"' | cut -d'"' -f4 || echo "")
    fi
elif [[ "$USE_COPY_SERVICE" == true ]]; then
    # Copy service not available, use defaults
    case "$COPY_TYPE" in
        workflow)
            CMD="${COPY_ARGS[0]:-}"
            EVT="${COPY_ARGS[1]:-}"
            TITLE="OSS: $CMD"
            MESSAGE="$EVT"
            ;;
        session)
            TITLE="OSS Session"
            MESSAGE="${COPY_ARGS[0]:-event}"
            ;;
        issue)
            TITLE="OSS Issue"
            MESSAGE="${COPY_ARGS[0]:-detected}"
            ;;
    esac
fi

# =============================================================================
# Load settings
# =============================================================================

SETTINGS_FILE=~/.oss/settings.json

if [[ -f "$SETTINGS_FILE" ]]; then
    if command -v jq &>/dev/null; then
        STYLE=$(jq -r '.notifications.style // "visual"' "$SETTINGS_FILE" 2>/dev/null || echo "visual")
        VOICE=$(jq -r '.notifications.voice // "Samantha"' "$SETTINGS_FILE" 2>/dev/null || echo "Samantha")
        SOUND=$(jq -r '.notifications.sound // "Glass"' "$SETTINGS_FILE" 2>/dev/null || echo "Glass")
    else
        STYLE=$(grep -o '"style"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "visual")
        VOICE=$(grep -o '"voice"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "Samantha")
        SOUND=$(grep -o '"sound"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "Glass")
    fi
else
    STYLE="visual"
    VOICE="Samantha"
    SOUND="Glass"
fi

# =============================================================================
# Update workflow state (for Claude Code status line)
# =============================================================================

if [[ "$USE_COPY_SERVICE" == true && "$COPY_TYPE" == "workflow" ]]; then
    WORKFLOW_CMD="${COPY_ARGS[0]:-}"
    WORKFLOW_EVENT="${COPY_ARGS[1]:-}"
    WORKFLOW_CONTEXT="${COPY_ARGS[2]:-}"
    [[ -n "$WORKFLOW_CONTEXT" ]] || WORKFLOW_CONTEXT='{}'

    # Write to workflow log file
    if [[ -x "$LOG_SCRIPT" && -n "$WORKFLOW_CMD" ]]; then
        LOG_MSG="[$WORKFLOW_EVENT]"
        if [[ -n "$WORKFLOW_CONTEXT" && "$WORKFLOW_CONTEXT" != "{}" ]]; then
            # Extract key info from context for log
            if command -v jq &>/dev/null; then
                CONTEXT_SUMMARY=$(echo "$WORKFLOW_CONTEXT" | jq -r 'to_entries | map("\(.key)=\(.value)") | join(", ")' 2>/dev/null || echo "$WORKFLOW_CONTEXT")
                LOG_MSG="$LOG_MSG $CONTEXT_SUMMARY"
            else
                LOG_MSG="$LOG_MSG $WORKFLOW_CONTEXT"
            fi
        fi
        "$LOG_SCRIPT" write "$WORKFLOW_CMD" "$LOG_MSG" 2>/dev/null || true
    fi

    # Update workflow state based on workflow event
    if [[ -f "$WORKFLOW_STATE_CLI" ]]; then
        case "$WORKFLOW_EVENT" in
            start)
                wf_state setActiveStep "$WORKFLOW_CMD" 2>/dev/null || true
                wf_state setCurrentCommand "$WORKFLOW_CMD" 2>/dev/null || true
                wf_state setSupervisor watching 2>/dev/null || true
                # Clear stale state from previous workflow
                wf_state clearTddPhase 2>/dev/null || true
                wf_state clearLastCommand 2>/dev/null || true
                wf_state setWorkflowComplete false 2>/dev/null || true
                wf_state clearProgress 2>/dev/null || true
                # Set nextCommand based on workflow chain position
                case "$WORKFLOW_CMD" in
                    ideate) wf_state setNextCommand "plan" 2>/dev/null || true ;;
                    plan)   wf_state setNextCommand "build" 2>/dev/null || true ;;
                    build)  wf_state setNextCommand "ship" 2>/dev/null || true ;;
                    ship)   wf_state clearNextCommand 2>/dev/null || true ;;
                    *)      ;; # Non-chain commands don't affect nextCommand
                esac
                # Track ALL command invocations via analytics API
                # Note: oss-decrypt also tracks when prompts are fetched from API,
                # but cached prompts bypass the API, so we track here as the source of truth
                (
                    if oss_api_creds; then   # key and URL from one read (T37)
                        oss_api_curl "$OSS_KEY" -sS -m 5 -X POST "${OSS_URL}/api/v1/analytics/track" \
                            -H "Content-Type: application/json" \
                            -d "{\"command\": \"$WORKFLOW_CMD\", \"promptType\": \"command\", \"promptName\": \"$WORKFLOW_CMD\"}" \
                            >/dev/null 2>&1 || true
                    fi
                ) </dev/null >/dev/null 2>&1 &
                ;;
            merged)
                # When ship merged, reset the entire workflow chain to start fresh
                if [[ "$WORKFLOW_CMD" == "ship" ]]; then
                    wf_state reset 2>/dev/null || true
                else
                    wf_state completeStep "$WORKFLOW_CMD" 2>/dev/null || true
                fi
                # Log IRON LAW compliance checklist on merge
                "$LOG_SCRIPT" checklist "$WORKFLOW_CMD" 2>/dev/null || true
                ;;
            complete)
                # F7/F8: state updates are bounded (2s each) and silent; only the CHAIN block below reaches the model
                wf_state_timeout 2 completeStep "$WORKFLOW_CMD" >/dev/null 2>&1 || true
                # Clear currentCommand since it's done
                wf_state_timeout 2 clearCurrentCommand >/dev/null 2>&1 || true
                # Clear TDD phase so it doesn't show stale indicator after build ends
                wf_state_timeout 2 clearTddPhase >/dev/null 2>&1 || true
                # Set lastCommand for status line display (shows last_cmd → next_cmd)
                wf_state_timeout 2 setLastCommand "$WORKFLOW_CMD" >/dev/null 2>&1 || true
                # Set nextCommand based on workflow progression
                case "$WORKFLOW_CMD" in
                    ideate) wf_state_timeout 2 setNextCommand "plan" >/dev/null 2>&1 || true ;;
                    plan) wf_state_timeout 2 setNextCommand "build" >/dev/null 2>&1 || true ;;
                    build) wf_state_timeout 2 setNextCommand "ship" >/dev/null 2>&1 || true ;;
                    ship)
                        wf_state_timeout 2 clearNextCommand >/dev/null 2>&1 || true
                        # Set workflowComplete flag for status line to show "→ DONE"
                        wf_state_timeout 2 setWorkflowComplete true >/dev/null 2>&1 || true
                        ;;
                    *) ;; # Non-chain commands don't affect nextCommand
                esac
                # Log IRON LAW compliance checklist on command completion
                "$LOG_SCRIPT" checklist "$WORKFLOW_CMD" 2>/dev/null || true
                # Output chain instructions for Claude to invoke as skills
                # Runs synchronously so stdout (CHAIN: lines) is visible to Claude
                # Stderr goes to log file for debugging
                CHAIN_TRIGGER_LOG="$HOME/.oss/logs/chain-trigger.log"
                mkdir -p "$(dirname "$CHAIN_TRIGGER_LOG")" 2>/dev/null
                if [[ -f "$CHAIN_TRIGGER_CLI" ]]; then
                    run_with_timeout 30 node "$CHAIN_TRIGGER_CLI" --workflow "$WORKFLOW_CMD" 2>> "$CHAIN_TRIGGER_LOG" || true
                fi
                ;;
            failed)
                wf_state setSupervisor intervening 2>/dev/null || true
                ;;
            task_complete)
                # Extract progress from context
                if command -v jq &>/dev/null; then
                    CURRENT=$(echo "$WORKFLOW_CONTEXT" | jq -r '.current // ""' 2>/dev/null)
                    TOTAL=$(echo "$WORKFLOW_CONTEXT" | jq -r '.total // ""' 2>/dev/null)
                    TASK_NAME=$(echo "$WORKFLOW_CONTEXT" | jq -r '.taskName // ""' 2>/dev/null)
                    TDD_PHASE=$(echo "$WORKFLOW_CONTEXT" | jq -r '.tddPhase // ""' 2>/dev/null)

                    if [[ -n "$TDD_PHASE" && "$TDD_PHASE" != "null" ]]; then
                        wf_state setTddPhase "$TDD_PHASE" 2>/dev/null || true
                    fi

                    if [[ -n "$CURRENT" && "$CURRENT" != "null" ]]; then
                        PROGRESS_JSON=$(jq -cn --arg p "$CURRENT/$TOTAL" --arg t "$TASK_NAME" '{progress: $p, currentTask: $t}')
                        wf_state setProgress "$PROGRESS_JSON" 2>/dev/null || true
                    fi
                fi
                ;;
        esac
    fi

    exit 0
fi

# =============================================================================
# Handle session notifications (update workflow state for status line)
# =============================================================================

if [[ "$USE_COPY_SERVICE" == true && "$COPY_TYPE" == "session" ]]; then
    SESSION_EVENT="${COPY_ARGS[0]:-}"
    SESSION_CONTEXT="${COPY_ARGS[1]:-}"
    [[ -n "$SESSION_CONTEXT" ]] || SESSION_CONTEXT='{}'

    # Update workflow state for session events (with timeout to prevent hanging)
    if [[ -f "$WORKFLOW_STATE_CLI" ]]; then
        case "$SESSION_EVENT" in
            context_restored|fresh_start)
                wf_state_timeout 2 setSupervisor watching 2>/dev/null
                # Set non-sticky notification (auto-clears after 10 seconds)
                if [[ -n "$MESSAGE" && "$MESSAGE" != "" ]]; then
                    wf_state_timeout 2 setNotification "$MESSAGE" 10 2>/dev/null
                fi
                # Check for plugin/prompt updates (non-blocking, background)
                if [[ -x "$SCRIPT_DIR/check-updates.sh" ]]; then
                    (
                        update_msg=$(run_with_timeout 3 "$SCRIPT_DIR/check-updates.sh" 2>/dev/null)
                        if [[ -n "$update_msg" ]]; then
                            # Wait for session notification to expire before showing update
                            sleep 11
                            wf_state_timeout 2 setNotification "$update_msg" 30 2>/dev/null
                        fi
                    ) </dev/null >/dev/null 2>&1 &
                fi
                ;;
            context_saved)
                wf_state_timeout 2 setSupervisor idle 2>/dev/null
                ;;
        esac
    fi

    # Write to log file for session events
    if [[ -x "$LOG_SCRIPT" && -n "$SESSION_EVENT" ]]; then
        "$LOG_SCRIPT" write "session" "[$SESSION_EVENT] $SESSION_CONTEXT" 2>/dev/null || true
    fi

    # Session start notifications only update status line (workflow state above)
    # The "Ready" notification for user input is handled by oss-notification.sh
    # The "Done" notification for task completion is handled by oss-stop.sh

    exit 0
fi

# =============================================================================
# Handle issue notifications (update workflow state for status line)
# =============================================================================

if [[ "$USE_COPY_SERVICE" == true && "$COPY_TYPE" == "issue" ]]; then
    ISSUE_TYPE="${COPY_ARGS[0]:-}"
    ISSUE_CONTEXT="${COPY_ARGS[1]:-}"
    [[ -n "$ISSUE_CONTEXT" ]] || ISSUE_CONTEXT='{}'

    # Update workflow state to show issue in status line
    if [[ -f "$WORKFLOW_STATE_CLI" ]]; then
        wf_state setSupervisor intervening 2>/dev/null || true
        # Extract message from context if available
        if command -v jq &>/dev/null; then
            ISSUE_MSG=$(echo "$ISSUE_CONTEXT" | jq -r '.message // ""' 2>/dev/null)
            if [[ -n "$ISSUE_MSG" && "$ISSUE_MSG" != "null" ]]; then
                wf_state setIssue "$ISSUE_TYPE" "$ISSUE_MSG" 2>/dev/null || true
            fi
        fi
    fi

    # Write to log file for issue events
    if [[ -x "$LOG_SCRIPT" && -n "$ISSUE_TYPE" ]]; then
        "$LOG_SCRIPT" write "issue" "[$ISSUE_TYPE] $ISSUE_CONTEXT" 2>/dev/null || true
    fi

    # Issue notifications ONLY update the status line - no terminal-notifier
    exit 0
fi

# =============================================================================
# Direct notifications (legacy - only used for explicit title/message calls)
# These are for backward compatibility with direct script invocation
# =============================================================================

case "$STYLE" in
    "audio")
        if command -v say &>/dev/null; then
            say -v "$VOICE" "$MESSAGE" &>/dev/null || true
        fi
        ;;
    "sound")
        SOUND_FILE="/System/Library/Sounds/${SOUND}.aiff"
        if [[ -f "$SOUND_FILE" ]] && command -v afplay &>/dev/null; then
            afplay "$SOUND_FILE" &>/dev/null || true
        fi
        ;;
    # "visual" and other styles - no-op, status line handles this
esac

exit 0
