#!/bin/bash
# OSS Dev Workflow - SwiftBar Plugin
# Shows workflow chain state in menu bar
#
# Naming: oss-workflow.1s.sh = refreshes every 1 second
# Install: Copy to ~/Library/Application Support/SwiftBar/Plugins/
#
# Reads state from: ~/.oss/workflow-state.json

STATE_FILE="${HOME}/.oss/workflow-state.json"

# Queue file location - check multiple places since SwiftBar runs outside Claude Code context
# Priority: 1) CLAUDE_PROJECT_DIR if set, 2) ~/.oss/current-project marker, 3) ~/.oss/queue.json
QUEUE_FILE=""
if [[ -n "$CLAUDE_PROJECT_DIR" && -f "$CLAUDE_PROJECT_DIR/.oss/queue.json" ]]; then
    QUEUE_FILE="$CLAUDE_PROJECT_DIR/.oss/queue.json"
elif [[ -f "${HOME}/.oss/current-project" ]]; then
    # Read project path from marker file (set by session-start hook)
    CURRENT_PROJECT=$(cat "${HOME}/.oss/current-project" 2>/dev/null)
    if [[ -n "$CURRENT_PROJECT" && -f "$CURRENT_PROJECT/.oss/queue.json" ]]; then
        QUEUE_FILE="$CURRENT_PROJECT/.oss/queue.json"
    fi
fi
# Fallback to global queue if exists
if [[ -z "$QUEUE_FILE" && -f "${HOME}/.oss/queue.json" ]]; then
    QUEUE_FILE="${HOME}/.oss/queue.json"
fi

# =============================================================================
# Read state file
# =============================================================================

if [[ ! -f "$STATE_FILE" ]]; then
    # No active workflow - show idle state
    echo "🤖"
    echo "---"
    echo "OSS Dev Workflow | color=#666666"
    echo "No active workflow"
    echo "---"
    echo "Run /oss:ideate to start | color=#888888"
    exit 0
fi

# Parse state with jq (required dependency)
if ! command -v jq &>/dev/null; then
    echo "🤖❓"
    echo "---"
    echo "jq not installed | color=red"
    echo "Run: brew install jq | bash='brew' param1='install' param2='jq' terminal=true"
    exit 0
fi

# Read state values
SUPERVISOR=$(jq -r '.supervisor // "idle"' "$STATE_FILE" 2>/dev/null)
ACTIVE_STEP=$(jq -r '.activeStep // ""' "$STATE_FILE" 2>/dev/null)
CURRENT_TASK=$(jq -r '.currentTask // ""' "$STATE_FILE" 2>/dev/null)
PROGRESS=$(jq -r '.progress // ""' "$STATE_FILE" 2>/dev/null)
TESTS_PASS=$(jq -r '.testsPass // 0' "$STATE_FILE" 2>/dev/null)
LAST_UPDATE=$(jq -r '.lastUpdate // ""' "$STATE_FILE" 2>/dev/null)

# Read queue count (from project's .oss/queue.json)
QUEUE_COUNT=0
QUEUE_CRITICAL=0
if [[ -f "$QUEUE_FILE" ]]; then
    QUEUE_COUNT=$(jq '.tasks | map(select(.status == "pending")) | length' "$QUEUE_FILE" 2>/dev/null || echo "0")
    QUEUE_CRITICAL=$(jq '.tasks | map(select(.status == "pending" and .priority == "critical")) | length' "$QUEUE_FILE" 2>/dev/null || echo "0")
fi

# Read chain state
IDEATE_STATE=$(jq -r '.chainState.ideate // "pending"' "$STATE_FILE" 2>/dev/null)
PLAN_STATE=$(jq -r '.chainState.plan // "pending"' "$STATE_FILE" 2>/dev/null)
ACCEPTANCE_STATE=$(jq -r '.chainState.acceptance // "pending"' "$STATE_FILE" 2>/dev/null)
RED_STATE=$(jq -r '.chainState.red // "pending"' "$STATE_FILE" 2>/dev/null)
GREEN_STATE=$(jq -r '.chainState.green // "pending"' "$STATE_FILE" 2>/dev/null)
REFACTOR_STATE=$(jq -r '.chainState.refactor // "pending"' "$STATE_FILE" 2>/dev/null)
INTEGRATION_STATE=$(jq -r '.chainState.integration // "pending"' "$STATE_FILE" 2>/dev/null)
SHIP_STATE=$(jq -r '.chainState.ship // "pending"' "$STATE_FILE" 2>/dev/null)

# =============================================================================
# Menu bar icon based on supervisor status
# =============================================================================

case "$SUPERVISOR" in
    "watching")
        ICON="🤖✓"
        ;;
    "intervening")
        ICON="🤖⚡"
        ;;
    *)
        ICON="🤖✗"
        ;;
esac

# Build menu bar title
TITLE="$ICON"

# Show active step if available
if [[ -n "$ACTIVE_STEP" && "$ACTIVE_STEP" != "null" ]]; then
    STEP_DISPLAY=$(echo "$ACTIVE_STEP" | tr '[:lower:]' '[:upper:]')
    TITLE="$TITLE $STEP_DISPLAY"
fi

# Show queue count if there are pending tasks
if [[ "$QUEUE_COUNT" -gt 0 ]]; then
    if [[ "$QUEUE_CRITICAL" -gt 0 ]]; then
        TITLE="$TITLE 🚨$QUEUE_COUNT"
    else
        TITLE="$TITLE 📋$QUEUE_COUNT"
    fi
fi

echo "$TITLE"

echo "---"

# =============================================================================
# Helper function to format step
# =============================================================================
format_step() {
    local name="$1"
    local state="$2"

    case "$state" in
        "done")
            echo "✓ $name | color=green"
            ;;
        "active")
            local upper=$(echo "$name" | tr '[:lower:]' '[:upper:]')
            echo "▶ $upper | color=white"
            ;;
        *)
            echo "○ $name | color=#666666"
            ;;
    esac
}

# =============================================================================
# Workflow chain visualization
# =============================================================================

echo "Workflow Chain | size=12 color=#888888"
echo "---"
format_step "ideate" "$IDEATE_STATE"
format_step "plan" "$PLAN_STATE"
echo "---"
echo "Build Phases | size=11 color=#888888"
format_step "  acceptance" "$ACCEPTANCE_STATE"
format_step "  red" "$RED_STATE"
format_step "  green" "$GREEN_STATE"
format_step "  refactor" "$REFACTOR_STATE"
format_step "  integration" "$INTEGRATION_STATE"
echo "---"
format_step "ship" "$SHIP_STATE"

echo "---"

# =============================================================================
# Current status
# =============================================================================

if [[ -n "$CURRENT_TASK" && "$CURRENT_TASK" != "null" ]]; then
    echo "Current: $CURRENT_TASK | size=11"
fi

if [[ -n "$PROGRESS" && "$PROGRESS" != "null" ]]; then
    echo "Progress: $PROGRESS | size=11"
fi

if [[ "$TESTS_PASS" != "0" && "$TESTS_PASS" != "null" ]]; then
    echo "Tests: $TESTS_PASS passing | color=green size=11"
fi

echo "---"

# =============================================================================
# Queue status
# =============================================================================

if [[ "$QUEUE_COUNT" -gt 0 ]]; then
    if [[ "$QUEUE_CRITICAL" -gt 0 ]]; then
        echo "Queue: $QUEUE_COUNT task(s) 🚨 | color=red"
        echo "--$QUEUE_CRITICAL critical | color=red"
    else
        echo "Queue: $QUEUE_COUNT task(s) | color=orange"
    fi

    # Show first pending task preview
    if [[ -f "$QUEUE_FILE" ]]; then
        FIRST_TASK=$(jq -r '.tasks[] | select(.status == "pending") | "\(.priority | ascii_upcase): \(.anomaly_type)"' "$QUEUE_FILE" 2>/dev/null | head -1)
        if [[ -n "$FIRST_TASK" ]]; then
            echo "--Next: $FIRST_TASK | size=11 color=#888888"
        fi
    fi
    echo "---"
else
    echo "Queue: Empty ✓ | color=green"
    echo "---"
fi

# =============================================================================
# Supervisor status
# =============================================================================

echo "Supervisor | size=12 color=#888888"
case "$SUPERVISOR" in
    "watching")
        echo "✓ Watching | color=green"
        ;;
    "intervening")
        echo "⚡ Intervening | color=orange"
        ;;
    *)
        echo "✗ Idle | color=#666666"
        ;;
esac

echo "---"

# =============================================================================
# Actions
# =============================================================================

echo "Refresh | refresh=true"
echo "Open Settings | bash='open' param1=\"$HOME/.oss/settings.json\" terminal=false"

# Show last update time
if [[ -n "$LAST_UPDATE" && "$LAST_UPDATE" != "null" ]]; then
    # Format timestamp for display
    if command -v gdate &>/dev/null; then
        FORMATTED=$(gdate -d "$LAST_UPDATE" "+%H:%M:%S" 2>/dev/null || echo "$LAST_UPDATE")
    else
        FORMATTED=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${LAST_UPDATE%%.*}" "+%H:%M:%S" 2>/dev/null || echo "$LAST_UPDATE")
    fi
    echo "---"
    echo "Updated: $FORMATTED | size=10 color=#888888"
fi
