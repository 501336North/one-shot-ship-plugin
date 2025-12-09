#!/bin/bash
# OSS preCommand Hook - Drains task queue before user commands
#
# Implements US-008 from REQUIREMENTS.md
# Triggered on: UserPromptSubmit (before user's command runs)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"
NOTIFY_SCRIPT="$PLUGIN_ROOT/hooks/oss-notify.sh"
MENUBAR_CLI="$PLUGIN_ROOT/watcher/dist/cli/update-menubar.js"
LOG_SCRIPT="$PLUGIN_ROOT/hooks/oss-log.sh"

# =============================================================================
# Detect /oss:* commands and update SwiftBar workflow state
# =============================================================================

USER_INPUT="${CLAUDE_USER_INPUT:-$*}"

# Check if this is an /oss: command
if [[ "$USER_INPUT" == /oss:* ]]; then
    # Extract command name (e.g., "ideate" from "/oss:ideate" or "/oss:ideate something")
    OSS_CMD=$(echo "$USER_INPUT" | sed -E 's|^/oss:([a-z-]+).*|\1|')

    # Map command to workflow step for menubar
    case "$OSS_CMD" in
        ideate)
            WORKFLOW_STEP="ideate"
            ;;
        requirements)
            WORKFLOW_STEP="requirements"
            ;;
        api-design)
            WORKFLOW_STEP="apiDesign"
            ;;
        data-model)
            WORKFLOW_STEP="dataModel"
            ;;
        adr)
            WORKFLOW_STEP="adr"
            ;;
        plan)
            WORKFLOW_STEP="plan"
            ;;
        acceptance)
            WORKFLOW_STEP="acceptance"
            ;;
        red)
            WORKFLOW_STEP="red"
            ;;
        mock)
            WORKFLOW_STEP="mock"
            ;;
        green)
            WORKFLOW_STEP="green"
            ;;
        refactor)
            WORKFLOW_STEP="refactor"
            ;;
        integration)
            WORKFLOW_STEP="integration"
            ;;
        contract)
            WORKFLOW_STEP="contract"
            ;;
        build)
            WORKFLOW_STEP="build"
            ;;
        ship)
            WORKFLOW_STEP="ship"
            ;;
        *)
            # Not a workflow step command (e.g., login, settings, queue)
            WORKFLOW_STEP=""
            ;;
    esac

    # Update menubar state if this is a workflow command
    if [[ -n "$WORKFLOW_STEP" && -f "$MENUBAR_CLI" ]]; then
        node "$MENUBAR_CLI" setActiveStep "$WORKFLOW_STEP" 2>/dev/null || true
        node "$MENUBAR_CLI" setSupervisor watching 2>/dev/null || true
    fi

    # Initialize log file for this command
    if [[ -x "$LOG_SCRIPT" ]]; then
        "$LOG_SCRIPT" init "$OSS_CMD" 2>/dev/null || true
    fi

    # Auto-archive completed features before /oss:plan
    # This ensures dev/active/ stays clean and focused on current work
    # Only on plan (not ship) - ship is for current feature, archive happens on next plan
    ARCHIVE_SCRIPT="$PLUGIN_ROOT/hooks/oss-archive-check.sh"
    if [[ "$OSS_CMD" == "plan" && -x "$ARCHIVE_SCRIPT" ]]; then
        ARCHIVE_OUTPUT=$("$ARCHIVE_SCRIPT" 2>/dev/null)
        if [[ -n "$ARCHIVE_OUTPUT" && "$ARCHIVE_OUTPUT" != *"No completed"* ]]; then
            echo ""
            echo "OSS: 📦 Auto-archiving completed features..."
            echo "$ARCHIVE_OUTPUT"
            echo ""
        fi
    fi
fi

# Check for --no-queue flag in user's command
if [[ "$*" == *"--no-queue"* ]]; then
    exit 0
fi

# Determine project directory - check multiple sources
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "$PROJECT_DIR" && -f "${HOME}/.oss/current-project" ]]; then
    PROJECT_DIR=$(cat "${HOME}/.oss/current-project" 2>/dev/null)
fi
PROJECT_DIR="${PROJECT_DIR:-.}"

# Check if .oss directory exists
OSS_DIR="$PROJECT_DIR/.oss"
if [[ ! -d "$OSS_DIR" ]]; then
    # No .oss directory - create it
    mkdir -p "$OSS_DIR"
fi

# Check if queue file exists
QUEUE_FILE="$OSS_DIR/queue.json"
if [[ ! -f "$QUEUE_FILE" ]]; then
    exit 0
fi

# Count pending tasks and get priorities using jq or simple grep
if command -v jq &>/dev/null; then
    TASK_COUNT=$(jq '.tasks | map(select(.status == "pending")) | length' "$QUEUE_FILE" 2>/dev/null || echo "0")
    CRITICAL_COUNT=$(jq '.tasks | map(select(.status == "pending" and .priority == "critical")) | length' "$QUEUE_FILE" 2>/dev/null || echo "0")
    HIGH_COUNT=$(jq '.tasks | map(select(.status == "pending" and .priority == "high")) | length' "$QUEUE_FILE" 2>/dev/null || echo "0")
else
    # Fallback: count "pending" occurrences (rough estimate)
    TASK_COUNT=$(grep -c '"status": "pending"' "$QUEUE_FILE" 2>/dev/null || echo "0")
    CRITICAL_COUNT="?"
    HIGH_COUNT="?"
fi

if [[ "$TASK_COUNT" == "0" ]] || [[ -z "$TASK_COUNT" ]]; then
    exit 0
fi

# Build priority summary
PRIORITY_SUMMARY=""
if [[ "$CRITICAL_COUNT" != "?" ]] && [[ "$CRITICAL_COUNT" -gt 0 ]]; then
    PRIORITY_SUMMARY="$CRITICAL_COUNT critical"
fi
if [[ "$HIGH_COUNT" != "?" ]] && [[ "$HIGH_COUNT" -gt 0 ]]; then
    if [[ -n "$PRIORITY_SUMMARY" ]]; then
        PRIORITY_SUMMARY="$PRIORITY_SUMMARY, $HIGH_COUNT high"
    else
        PRIORITY_SUMMARY="$HIGH_COUNT high"
    fi
fi

# Display queue summary
echo ""
echo "OSS: ⚠️ $TASK_COUNT queued task(s) found${PRIORITY_SUMMARY:+ ($PRIORITY_SUMMARY)}"

# Send visual notification
if [[ -x "$NOTIFY_SCRIPT" ]]; then
    if [[ "$CRITICAL_COUNT" -gt 0 ]]; then
        "$NOTIFY_SCRIPT" "🚨 Queue Alert" "$TASK_COUNT task(s) pending - $CRITICAL_COUNT critical!" critical
    else
        "$NOTIFY_SCRIPT" "📋 Queue Alert" "$TASK_COUNT task(s) pending" high
    fi
fi

# Check if watcher/drain-queue.js exists
DRAIN_SCRIPT="$PLUGIN_ROOT/watcher/dist/drain-queue.js"
if [[ -f "$DRAIN_SCRIPT" ]]; then
    # Execute the drain script
    node "$DRAIN_SCRIPT" 2>/dev/null
else
    # Fallback: Just show the summary, don't drain
    echo "OSS: Queue drain script not found. Run 'npm run build' in watcher directory."

    # Show first pending task info
    if command -v jq &>/dev/null; then
        FIRST_TASK=$(jq -r '.tasks[] | select(.status == "pending") | "\(.priority | ascii_upcase): \(.prompt | .[0:100])"' "$QUEUE_FILE" 2>/dev/null | head -1)
        if [[ -n "$FIRST_TASK" ]]; then
            echo "OSS: Next task: $FIRST_TASK..."
        fi
    fi
fi

exit 0
