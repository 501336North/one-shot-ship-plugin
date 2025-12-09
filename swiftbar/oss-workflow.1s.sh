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

# Read chain state - Discovery Chain
IDEATE_STATE=$(jq -r '.chainState.ideate // "pending"' "$STATE_FILE" 2>/dev/null)
REQUIREMENTS_STATE=$(jq -r '.chainState.requirements // "pending"' "$STATE_FILE" 2>/dev/null)
API_DESIGN_STATE=$(jq -r '.chainState.apiDesign // "pending"' "$STATE_FILE" 2>/dev/null)
DATA_MODEL_STATE=$(jq -r '.chainState.dataModel // "pending"' "$STATE_FILE" 2>/dev/null)
ADR_STATE=$(jq -r '.chainState.adr // "pending"' "$STATE_FILE" 2>/dev/null)

# Read chain state - Planning Chain
PLAN_STATE=$(jq -r '.chainState.plan // "pending"' "$STATE_FILE" 2>/dev/null)
ACCEPTANCE_STATE=$(jq -r '.chainState.acceptance // "pending"' "$STATE_FILE" 2>/dev/null)

# Read chain state - Build Chain (TDD Loop)
RED_STATE=$(jq -r '.chainState.red // "pending"' "$STATE_FILE" 2>/dev/null)
MOCK_STATE=$(jq -r '.chainState.mock // "pending"' "$STATE_FILE" 2>/dev/null)
GREEN_STATE=$(jq -r '.chainState.green // "pending"' "$STATE_FILE" 2>/dev/null)
REFACTOR_STATE=$(jq -r '.chainState.refactor // "pending"' "$STATE_FILE" 2>/dev/null)
INTEGRATION_STATE=$(jq -r '.chainState.integration // "pending"' "$STATE_FILE" 2>/dev/null)
CONTRACT_STATE=$(jq -r '.chainState.contract // "pending"' "$STATE_FILE" 2>/dev/null)

# Read chain state - Ship Chain
SHIP_STATE=$(jq -r '.chainState.ship // "pending"' "$STATE_FILE" 2>/dev/null)

# Read TDD cycle counter
TDD_CYCLE=$(jq -r '.tddCycle // 1' "$STATE_FILE" 2>/dev/null)

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

# Discovery Chain
echo "Discovery | size=11 color=#888888"
format_step "  ideate" "$IDEATE_STATE"
format_step "  requirements" "$REQUIREMENTS_STATE"
format_step "  api-design" "$API_DESIGN_STATE"
format_step "  data-model" "$DATA_MODEL_STATE"
format_step "  adr" "$ADR_STATE"

echo "---"

# Planning Chain
echo "Planning | size=11 color=#888888"
format_step "  plan" "$PLAN_STATE"
format_step "  acceptance" "$ACCEPTANCE_STATE"

echo "---"

# Build Chain (TDD Loop)
if [[ "$TDD_CYCLE" != "null" && "$TDD_CYCLE" -gt 1 ]]; then
    echo "Build (TDD Cycle $TDD_CYCLE) | size=11 color=#888888"
else
    echo "Build (TDD) | size=11 color=#888888"
fi
format_step "  red" "$RED_STATE"
format_step "  mock" "$MOCK_STATE"
format_step "  green" "$GREEN_STATE"
format_step "  refactor" "$REFACTOR_STATE"
format_step "  integration" "$INTEGRATION_STATE"
format_step "  contract" "$CONTRACT_STATE"

echo "---"

# Ship Chain
echo "Ship | size=11 color=#888888"
format_step "  ship" "$SHIP_STATE"

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
# Supervisor status and controls
# =============================================================================

# Get plugin root from marker file (set by session-start hook)
# SwiftBar runs outside Claude Code context, so we can't use CLAUDE_PLUGIN_ROOT
PLUGIN_ROOT=""
if [[ -f "$HOME/.oss/plugin-root" ]]; then
    PLUGIN_ROOT=$(cat "$HOME/.oss/plugin-root" 2>/dev/null)
fi

# CLI paths derived from plugin root
MENUBAR_CLI="$PLUGIN_ROOT/watcher/dist/cli/update-menubar.js"
HEALTH_CHECK_CLI="$PLUGIN_ROOT/watcher/dist/cli/health-check.js"
OSS_LOG_SCRIPT="$PLUGIN_ROOT/hooks/oss-log.sh"

echo "Supervisor | size=12 color=#888888"
case "$SUPERVISOR" in
    "watching")
        echo "✓ Watching | color=green"
        echo "--⏸ Pause Supervisor | bash='node' param1='$MENUBAR_CLI' param2='setSupervisor' param3='idle' terminal=false refresh=true"
        ;;
    "intervening")
        echo "⚡ Intervening | color=orange"
        echo "--⏸ Pause Supervisor | bash='node' param1='$MENUBAR_CLI' param2='setSupervisor' param3='idle' terminal=false refresh=true"
        ;;
    *)
        echo "✗ Idle | color=#666666"
        echo "--▶ Start Supervisor | bash='node' param1='$MENUBAR_CLI' param2='setSupervisor' param3='watching' terminal=false refresh=true"
        ;;
esac

echo "---"

# =============================================================================
# Actions
# =============================================================================

echo "Refresh | refresh=true"

# Session Log - unified chronological view
LOG_DIR="$HOME/.oss/logs/current-session"
SESSION_LOG="$LOG_DIR/session.log"
HEALTH_CHECK_LOG="$LOG_DIR/health-check.log"

if [[ -f "$SESSION_LOG" ]]; then
    SESSION_LINES=$(wc -l < "$SESSION_LOG" | tr -d ' ')
    SESSION_SIZE=$(du -h "$SESSION_LOG" | cut -f1)
    echo "📜 Session Log ($SESSION_LINES lines) | bash='open' param1=\"$SESSION_LOG\" terminal=false"
    if [[ -n "$PLUGIN_ROOT" && -x "$OSS_LOG_SCRIPT" ]]; then
        echo "--Tail in Terminal | bash='$OSS_LOG_SCRIPT' param1='tail' terminal=true"
    else
        echo "--Tail in Terminal | bash='tail' param1='-f' param2=\"$SESSION_LOG\" terminal=true"
    fi
else
    echo "📜 Session Log (empty) | color=#888888"
fi

# Health Check Log - prominent access for debugging startup issues
# Get current project for running health check
CURRENT_PROJECT=""
if [[ -f "$HOME/.oss/current-project" ]]; then
    CURRENT_PROJECT=$(cat "$HOME/.oss/current-project" 2>/dev/null)
fi
# HEALTH_CHECK_CLI already defined above from PLUGIN_ROOT

if [[ -f "$HEALTH_CHECK_LOG" ]]; then
    # Check entire log for result (search whole file, not just tail)
    # This handles logs of varying lengths
    if grep -q "HEALTH CHECK PASSED" "$HEALTH_CHECK_LOG"; then
        HC_STATUS="✅"
        HC_COLOR="green"
    elif grep -q "HEALTH CHECK FAILED" "$HEALTH_CHECK_LOG"; then
        HC_STATUS="❌"
        HC_COLOR="red"
    else
        HC_STATUS="⚠️"
        HC_COLOR="orange"
    fi
    HC_SIZE=$(du -h "$HEALTH_CHECK_LOG" | cut -f1)
    echo "$HC_STATUS Health Check ($HC_SIZE) | bash='open' param1=\"$HEALTH_CHECK_LOG\" terminal=false color=$HC_COLOR"
    echo "--View in Terminal | bash='cat' param1=\"$HEALTH_CHECK_LOG\" terminal=true"
    if [[ -n "$CURRENT_PROJECT" && -d "$CURRENT_PROJECT" ]]; then
        echo "--Run Health Check Now | bash='bash' param1='-c' param2='cd \"$CURRENT_PROJECT\" && node \"$HEALTH_CHECK_CLI\" --verbose' terminal=true refresh=true"
    else
        echo "--Run Health Check Now | color=#888888 (no active project)"
    fi
else
    echo "🔍 Health Check (not run) | color=#888888"
    if [[ -n "$CURRENT_PROJECT" && -d "$CURRENT_PROJECT" ]]; then
        echo "--Run Health Check Now | bash='bash' param1='-c' param2='cd \"$CURRENT_PROJECT\" && node \"$HEALTH_CHECK_CLI\" --verbose' terminal=true refresh=true"
    else
        echo "--Run Health Check Now | color=#888888 (no active project)"
    fi
fi

# Individual command logs submenu
if [[ -d "$LOG_DIR" ]]; then
    # Count logs excluding session.log and health-check.log (shown separately)
    LOG_COUNT=$(ls -1 "$LOG_DIR"/*.log 2>/dev/null | grep -v -E 'session\.log|health-check\.log' | wc -l | tr -d ' ')
    if [[ "$LOG_COUNT" -gt 0 ]]; then
        echo "Command Logs ($LOG_COUNT) | bash='open' param1=\"$LOG_DIR\" terminal=false"
        # Show individual log files as submenu items (exclude session.log and health-check.log)
        for logfile in "$LOG_DIR"/*.log; do
            if [[ -f "$logfile" ]]; then
                logname=$(basename "$logfile")
                if [[ "$logname" != "session.log" && "$logname" != "health-check.log" ]]; then
                    logname_short=$(basename "$logfile" .log)
                    logsize=$(du -h "$logfile" | cut -f1)
                    echo "--$logname_short ($logsize) | bash='open' param1=\"$logfile\" terminal=false"
                fi
            fi
        done
    else
        echo "Command Logs (none) | color=#888888"
    fi
else
    echo "Command Logs (no session) | color=#888888"
fi

echo "Open Settings | bash='open' param1=\"$HOME/.oss/settings.json\" terminal=false"

# Log management submenu
# OSS_LOG_SCRIPT already defined above from PLUGIN_ROOT
TOTAL_LOG_SIZE=$(du -sh "$HOME/.oss/logs" 2>/dev/null | cut -f1 || echo "0")
echo "Manage Logs ($TOTAL_LOG_SIZE)"
if [[ -n "$PLUGIN_ROOT" && -x "$OSS_LOG_SCRIPT" ]]; then
    echo "--📊 Log Status | bash='$OSS_LOG_SCRIPT' param1='status' terminal=true"
    echo "--🔄 Rotate Session Log | bash='$OSS_LOG_SCRIPT' param1='rotate' terminal=true refresh=true"
    echo "--🧹 Clean Old Logs | bash='$OSS_LOG_SCRIPT' param1='clean' terminal=true refresh=true"
    echo "--📦 View Archives | bash='$OSS_LOG_SCRIPT' param1='archives' terminal=true"
    echo "-----"
    echo "--⚠️ Purge All Logs | bash='$OSS_LOG_SCRIPT' param1='purge' terminal=true color=red"
else
    echo "--Log tools unavailable (start session first) | color=#888888"
fi

echo "Reset Workflow | bash='node' param1='$MENUBAR_CLI' param2='reset' terminal=false refresh=true color=#888888"

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
