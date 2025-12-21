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
COPY_CLI="$PLUGIN_ROOT/watcher/dist/cli/get-copy.js"
WORKFLOW_STATE_CLI="$PLUGIN_ROOT/watcher/dist/cli/update-workflow-state.js"
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
    # Call copy service CLI
    COPY_JSON=$(node "$COPY_CLI" "$COPY_TYPE" "${COPY_ARGS[@]}" 2>/dev/null || echo '{}')

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
# Filter by verbosity
# =============================================================================

case "$VERBOSITY" in
    "errors-only")
        [[ "$PRIORITY" != "critical" ]] && exit 0
        ;;
    "important")
        [[ "$PRIORITY" == "low" ]] && exit 0
        ;;
    # "all" - allow everything through
esac

# Skip if style is none
[[ "$STYLE" == "none" ]] && exit 0

# =============================================================================
# Update workflow state (for Claude Code status line)
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

    # Workflow notifications ONLY update the status line - do NOT send terminal-notifier
    # "Ready" and "Done" notifications use oss-notification.sh and oss-stop.sh instead
    exit 0
fi

# =============================================================================
# Dispatch notification (only for non-workflow notifications)
# =============================================================================

case "$STYLE" in
    "visual")
        # Visual notification (system notification sound plays automatically)
        OSS_ICON_PNG="$HOME/.oss/notification-icon.png"

        if command -v terminal-notifier &>/dev/null; then
            TN_ARGS=(-title "$TITLE" -message "$MESSAGE" -sound default)
            [[ -n "$SUBTITLE" ]] && TN_ARGS+=(-subtitle "$SUBTITLE")
            [[ -f "$OSS_ICON_PNG" ]] && TN_ARGS+=(-appIcon "$OSS_ICON_PNG")
            terminal-notifier "${TN_ARGS[@]}" &>/dev/null || true
        else
            # osascript fallback (no subtitle or icon support)
            osascript -e "display notification \"$MESSAGE\" with title \"$TITLE\"" &>/dev/null || true
        fi
        ;;
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
esac

exit 0
