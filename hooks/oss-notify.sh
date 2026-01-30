#!/bin/bash
# oss-notify.sh - Unified notification hook for OSS Dev Workflow
#
# Usage (direct):
#   oss-notify.sh "Title" "Message" [priority]
#
# Usage (with copy service):
#   oss-notify.sh --workflow <command> <event> [context-json]
#   oss-notify.sh --session <event> [context-json]
#   oss-notify.sh --issue <type> [context-json]
#
# Priority levels:
#   low      - Command start, agent spawn
#   high     - Command complete, PR created (default)
#   critical - Command failed, loop detected
#
# Respects settings from ~/.oss/settings.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"

# =============================================================================
# TIMEOUT WRAPPER - Prevents blocking on slow/hanging node calls
# =============================================================================
run_with_timeout() {
    local timeout_secs="${1:-2}"
    shift
    if command -v gtimeout &>/dev/null; then
        gtimeout "$timeout_secs" "$@" 2>/dev/null || true
    elif command -v timeout &>/dev/null; then
        timeout "$timeout_secs" "$@" 2>/dev/null || true
    else
        "$@" 2>/dev/null &
        local pid=$!
        (sleep "$timeout_secs" && kill -9 $pid 2>/dev/null) &
        local killer=$!
        wait $pid 2>/dev/null || true
        kill $killer 2>/dev/null || true
    fi
}

COPY_CLI="$PLUGIN_ROOT/watcher/dist/cli/get-copy.js"
WORKFLOW_STATE_CLI="$PLUGIN_ROOT/watcher/dist/cli/update-workflow-state.js"
TELEGRAM_CLI="$PLUGIN_ROOT/watcher/dist/cli/telegram-notify.js"
LOG_SCRIPT="$PLUGIN_ROOT/hooks/oss-log.sh"

# =============================================================================
# Parse arguments
# =============================================================================

USE_COPY_SERVICE=false
COPY_TYPE=""
COPY_ARGS=()
TITLE=""
MESSAGE=""
SUBTITLE=""
PRIORITY="high"

if [[ "${1:-}" == "--workflow" ]]; then
    USE_COPY_SERVICE=true
    COPY_TYPE="workflow"
    COPY_ARGS=("${@:2}")
    # Map command events to priorities and icons
    # NOTE: start is HIGH so users see when commands begin (per verbosity=important)
    CMD="${2:-}"
    EVENT="${3:-start}"
    case "$EVENT" in
        task_complete) PRIORITY="low" ;;
        start|complete|quality_passed|pr_created|merged) PRIORITY="high" ;;
        failed) PRIORITY="critical" ;;
    esac
elif [[ "${1:-}" == "--session" ]]; then
    USE_COPY_SERVICE=true
    COPY_TYPE="session"
    COPY_ARGS=("${@:2}")
    PRIORITY="high"
elif [[ "${1:-}" == "--issue" ]]; then
    USE_COPY_SERVICE=true
    COPY_TYPE="issue"
    COPY_ARGS=("${@:2}")
    PRIORITY="critical"
else
    # Direct usage: oss-notify.sh "Title" "Message" [priority]
    TITLE="${1:-Notification}"
    MESSAGE="${2:-}"
    PRIORITY="${3:-high}"
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
        VERBOSITY=$(jq -r '.notifications.verbosity // "important"' "$SETTINGS_FILE" 2>/dev/null || echo "important")
        VOICE=$(jq -r '.notifications.voice // "Samantha"' "$SETTINGS_FILE" 2>/dev/null || echo "Samantha")
        SOUND=$(jq -r '.notifications.sound // "Glass"' "$SETTINGS_FILE" 2>/dev/null || echo "Glass")
    else
        STYLE=$(grep -o '"style"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "visual")
        VERBOSITY=$(grep -o '"verbosity"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "important")
        VOICE=$(grep -o '"voice"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "Samantha")
        SOUND=$(grep -o '"sound"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "Glass")
    fi
else
    STYLE="visual"
    VERBOSITY="important"
    VOICE="Samantha"
    SOUND="Glass"
fi

# =============================================================================
# Filter by verbosity (only affects notifications, not state updates)
# =============================================================================

SKIP_NOTIFICATION=false
case "$VERBOSITY" in
    "errors-only")
        [[ "$PRIORITY" != "critical" ]] && SKIP_NOTIFICATION=true
        ;;
    "important")
        [[ "$PRIORITY" == "low" ]] && SKIP_NOTIFICATION=true
        ;;
    # "all" - allow everything through
esac

# Skip notification if style is none
[[ "$STYLE" == "none" ]] && SKIP_NOTIFICATION=true

# =============================================================================
# Update workflow state (for Claude Code status line)
# NOTE: This runs BEFORE notification filtering - state always updates
# =============================================================================

if [[ "$USE_COPY_SERVICE" == true && "$COPY_TYPE" == "workflow" ]]; then
    WORKFLOW_CMD="${COPY_ARGS[0]:-}"
    WORKFLOW_EVENT="${COPY_ARGS[1]:-}"
    WORKFLOW_CONTEXT="${COPY_ARGS[2]:-'{}'}"

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
                node "$WORKFLOW_STATE_CLI" setActiveStep "$WORKFLOW_CMD" 2>/dev/null || true
                node "$WORKFLOW_STATE_CLI" setSupervisor watching 2>/dev/null || true
                # Track ALL command invocations via analytics API
                # Note: oss-decrypt also tracks when prompts are fetched from API,
                # but cached prompts bypass the API, so we track here as the source of truth
                (
                    CONFIG_FILE=~/.oss/config.json
                    if [[ -f "$CONFIG_FILE" ]]; then
                        if command -v jq &>/dev/null; then
                            API_KEY=$(jq -r '.apiKey // ""' "$CONFIG_FILE" 2>/dev/null)
                            API_URL=$(jq -r '.apiUrl // "https://one-shot-ship-api.onrender.com"' "$CONFIG_FILE" 2>/dev/null)
                        else
                            API_KEY=$(grep -o '"apiKey"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/')
                            API_URL=$(grep -o '"apiUrl"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "https://one-shot-ship-api.onrender.com")
                        fi
                        if [[ -n "$API_KEY" ]]; then
                            curl -sS -X POST "${API_URL}/api/v1/analytics/track" \
                                -H "Authorization: Bearer $API_KEY" \
                                -H "Content-Type: application/json" \
                                -d "{\"command\": \"$WORKFLOW_CMD\", \"promptType\": \"command\", \"promptName\": \"$WORKFLOW_CMD\"}" \
                                >/dev/null 2>&1 || true
                        fi
                    fi
                ) &
                ;;
            merged)
                # When ship merged, reset the entire workflow chain to start fresh
                if [[ "$WORKFLOW_CMD" == "ship" ]]; then
                    node "$WORKFLOW_STATE_CLI" reset 2>/dev/null || true
                else
                    node "$WORKFLOW_STATE_CLI" completeStep "$WORKFLOW_CMD" 2>/dev/null || true
                fi
                # Log IRON LAW compliance checklist on merge
                "$LOG_SCRIPT" checklist "$WORKFLOW_CMD" 2>/dev/null || true
                ;;
            complete)
                node "$WORKFLOW_STATE_CLI" completeStep "$WORKFLOW_CMD" 2>/dev/null || true
                # Clear currentCommand since it's done
                node "$WORKFLOW_STATE_CLI" clearCurrentCommand 2>/dev/null || true
                # Set lastCommand for status line display (shows last_cmd → next_cmd)
                node "$WORKFLOW_STATE_CLI" setLastCommand "$WORKFLOW_CMD" 2>/dev/null || true
                # Set nextCommand based on workflow progression
                case "$WORKFLOW_CMD" in
                    ideate) node "$WORKFLOW_STATE_CLI" setNextCommand "plan" 2>/dev/null || true ;;
                    plan) node "$WORKFLOW_STATE_CLI" setNextCommand "build" 2>/dev/null || true ;;
                    build) node "$WORKFLOW_STATE_CLI" setNextCommand "ship" 2>/dev/null || true ;;
                    ship)
                        node "$WORKFLOW_STATE_CLI" clearNextCommand 2>/dev/null || true
                        # Set workflowComplete flag for status line to show "→ DONE"
                        node "$WORKFLOW_STATE_CLI" setWorkflowComplete true 2>/dev/null || true
                        ;;
                    *) ;; # Non-chain commands don't affect nextCommand
                esac
                # Log IRON LAW compliance checklist on command completion
                "$LOG_SCRIPT" checklist "$WORKFLOW_CMD" 2>/dev/null || true
                ;;
            failed)
                node "$WORKFLOW_STATE_CLI" setSupervisor intervening 2>/dev/null || true
                ;;
            task_complete)
                # Extract progress from context
                if command -v jq &>/dev/null; then
                    CURRENT=$(echo "$WORKFLOW_CONTEXT" | jq -r '.current // ""' 2>/dev/null)
                    TOTAL=$(echo "$WORKFLOW_CONTEXT" | jq -r '.total // ""' 2>/dev/null)
                    TASK_NAME=$(echo "$WORKFLOW_CONTEXT" | jq -r '.taskName // ""' 2>/dev/null)
                    TDD_PHASE=$(echo "$WORKFLOW_CONTEXT" | jq -r '.tddPhase // ""' 2>/dev/null)

                    if [[ -n "$TDD_PHASE" && "$TDD_PHASE" != "null" ]]; then
                        node "$WORKFLOW_STATE_CLI" setTddPhase "$TDD_PHASE" 2>/dev/null || true
                    fi

                    if [[ -n "$CURRENT" && "$CURRENT" != "null" ]]; then
                        node "$WORKFLOW_STATE_CLI" setProgress "{\"progress\": \"$CURRENT/$TOTAL\", \"currentTask\": \"$TASK_NAME\"}" 2>/dev/null || true
                    fi
                fi
                ;;
        esac
    fi

    # Send Telegram notification for workflow events if CLI exists
    # (skip if notification is filtered by verbosity OR if notifications.telegram.enabled is false)
    TELEGRAM_NOTIF_ENABLED="false"
    if [[ -f "$SETTINGS_FILE" ]] && command -v jq &>/dev/null; then
        TELEGRAM_NOTIF_ENABLED=$(jq -r '.notifications.telegram.enabled // false' "$SETTINGS_FILE" 2>/dev/null || echo "false")
    fi

    if [[ "$SKIP_NOTIFICATION" != true ]] && [[ "$TELEGRAM_NOTIF_ENABLED" == "true" ]] && [[ -f "$TELEGRAM_CLI" ]] && [[ -n "$MESSAGE" ]]; then
        # Build the notification message
        TELEGRAM_MSG="/oss:$WORKFLOW_CMD $WORKFLOW_EVENT"

        # Add context info for specific events
        case "$WORKFLOW_EVENT" in
            complete)
                if command -v jq &>/dev/null; then
                    TESTS=$(echo "$WORKFLOW_CONTEXT" | jq -r '.testsPass // ""' 2>/dev/null)
                    DURATION=$(echo "$WORKFLOW_CONTEXT" | jq -r '.duration // ""' 2>/dev/null)
                    if [[ -n "$TESTS" && "$TESTS" != "null" ]]; then
                        TELEGRAM_MSG="$TELEGRAM_MSG - $TESTS tests passing"
                    fi
                    if [[ -n "$DURATION" && "$DURATION" != "null" ]]; then
                        TELEGRAM_MSG="$TELEGRAM_MSG ($DURATION)"
                    fi
                fi
                ;;
            merged)
                if command -v jq &>/dev/null; then
                    PR_NUM=$(echo "$WORKFLOW_CONTEXT" | jq -r '.prNumber // ""' 2>/dev/null)
                    BRANCH=$(echo "$WORKFLOW_CONTEXT" | jq -r '.branch // ""' 2>/dev/null)
                    if [[ -n "$PR_NUM" && "$PR_NUM" != "null" ]]; then
                        TELEGRAM_MSG="$TELEGRAM_MSG - PR #$PR_NUM merged"
                    fi
                    if [[ -n "$BRANCH" && "$BRANCH" != "null" ]]; then
                        TELEGRAM_MSG="$TELEGRAM_MSG ($BRANCH)"
                    fi
                fi
                ;;
            failed)
                if command -v jq &>/dev/null; then
                    BLOCKER=$(echo "$WORKFLOW_CONTEXT" | jq -r '.blocker // ""' 2>/dev/null)
                    if [[ -n "$BLOCKER" && "$BLOCKER" != "null" ]]; then
                        TELEGRAM_MSG="$TELEGRAM_MSG - $BLOCKER"
                    fi
                fi
                ;;
        esac

        # Call telegram-notify.js (ignore errors so workflow continues)
        node "$TELEGRAM_CLI" --message "$TELEGRAM_MSG" 2>/dev/null || true
    fi

    exit 0
fi

# =============================================================================
# Handle session notifications (update workflow state for status line)
# =============================================================================

if [[ "$USE_COPY_SERVICE" == true && "$COPY_TYPE" == "session" ]]; then
    SESSION_EVENT="${COPY_ARGS[0]:-}"
    SESSION_CONTEXT="${COPY_ARGS[1]:-'{}'}"

    # Update workflow state for session events (with timeout to prevent hanging)
    if [[ -f "$WORKFLOW_STATE_CLI" ]]; then
        case "$SESSION_EVENT" in
            context_restored|fresh_start)
                run_with_timeout 2 node "$WORKFLOW_STATE_CLI" setSupervisor watching
                # Set non-sticky notification (auto-clears after 10 seconds)
                if [[ -n "$MESSAGE" && "$MESSAGE" != "" ]]; then
                    run_with_timeout 2 node "$WORKFLOW_STATE_CLI" setNotification "$MESSAGE" 10
                fi
                ;;
            context_saved)
                run_with_timeout 2 node "$WORKFLOW_STATE_CLI" setSupervisor idle
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
    ISSUE_CONTEXT="${COPY_ARGS[1]:-'{}'}"

    # Update workflow state to show issue in status line
    if [[ -f "$WORKFLOW_STATE_CLI" ]]; then
        node "$WORKFLOW_STATE_CLI" setSupervisor intervening 2>/dev/null || true
        # Extract message from context if available
        if command -v jq &>/dev/null; then
            ISSUE_MSG=$(echo "$ISSUE_CONTEXT" | jq -r '.message // ""' 2>/dev/null)
            if [[ -n "$ISSUE_MSG" && "$ISSUE_MSG" != "null" ]]; then
                node "$WORKFLOW_STATE_CLI" setIssue "$ISSUE_TYPE" "$ISSUE_MSG" 2>/dev/null || true
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
