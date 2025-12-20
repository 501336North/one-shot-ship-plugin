#!/bin/bash
# OSS Dev Workflow - Claude Code Status Line Script
#
# Shows workflow status in Claude Code status line.
# Reads from ~/.oss/*.json files (written by workflow commands and hooks)
#
# Usage: Configure in .claude/settings.json:
#   {
#     "statusLine": {
#       "type": "command",
#       "command": "~/.oss/oss-statusline.sh",
#       "padding": 0
#     }
#   }
#
# Input: Claude Code provides JSON context via stdin
# Output: Single line status text

# Read Claude Code context from stdin
INPUT=$(cat)

# Extract model name and directory using jq
if ! command -v jq &>/dev/null; then
    echo "[jq required]"
    exit 0
fi

MODEL=$(echo "$INPUT" | jq -r '.model.display_name // "Claude"')
CURRENT_DIR=$(echo "$INPUT" | jq -r '.workspace.current_dir // "." | gsub(".*/"; "")')

# === OSS HEALTH STATUS ===
# Check for active IRON LAW violations
OSS_HEALTH="✅"  # Default: all good
IRON_LAW_FILE="${HOME}/.oss/iron-law-state.json"

if [[ -f "$IRON_LAW_FILE" ]]; then
    # Check for unresolved violations (detected but not resolved, or resolved is null)
    ACTIVE_VIOLATIONS=$(jq '[.violations[] | select(.resolved == null or .resolved == "null")] | length' "$IRON_LAW_FILE" 2>/dev/null)

    if [[ -n "$ACTIVE_VIOLATIONS" && "$ACTIVE_VIOLATIONS" != "null" && "$ACTIVE_VIOLATIONS" -gt 0 ]]; then
        # Get the first active violation's law number
        VIOLATED_LAW=$(jq -r '[.violations[] | select(.resolved == null or .resolved == "null")][0].law // ""' "$IRON_LAW_FILE" 2>/dev/null)
        OSS_HEALTH="⛔ LAW#$VIOLATED_LAW"
    fi
fi

# === WORKFLOW STATUS ===
OSS_STATUS=""
ISSUE_DISPLAY=""
WORKFLOW_FILE="${HOME}/.oss/workflow-state.json"

if [[ -f "$WORKFLOW_FILE" ]]; then
    CURRENT_CMD=$(jq -r '.currentCommand // .activeStep // ""' "$WORKFLOW_FILE" 2>/dev/null)
    TDD_PHASE=$(jq -r '.tddPhase // ""' "$WORKFLOW_FILE" 2>/dev/null)
    SUPERVISOR=$(jq -r '.supervisor // ""' "$WORKFLOW_FILE" 2>/dev/null)
    PROGRESS=$(jq -r '.progress // ""' "$WORKFLOW_FILE" 2>/dev/null)
    CURRENT_TASK=$(jq -r '.currentTask // ""' "$WORKFLOW_FILE" 2>/dev/null)

    # Check for daemon-reported issues
    ISSUE_TYPE=$(jq -r '.issue.type // ""' "$WORKFLOW_FILE" 2>/dev/null)
    ISSUE_MSG=$(jq -r '.issue.message // ""' "$WORKFLOW_FILE" 2>/dev/null)
    ISSUE_SEVERITY=$(jq -r '.issue.severity // ""' "$WORKFLOW_FILE" 2>/dev/null)

    if [[ -n "$ISSUE_TYPE" && "$ISSUE_TYPE" != "null" && "$ISSUE_TYPE" != "" ]]; then
        case "$ISSUE_SEVERITY" in
            "error")
                ISSUE_DISPLAY=" | ⛔ $ISSUE_MSG"
                ;;
            "warning")
                ISSUE_DISPLAY=" | ⚠️ $ISSUE_MSG"
                ;;
            "info")
                ISSUE_DISPLAY=" | ℹ️ $ISSUE_MSG"
                ;;
            *)
                ISSUE_DISPLAY=" | $ISSUE_MSG"
                ;;
        esac
    fi

    # Format TDD phase with colored emoji
    if [[ -n "$TDD_PHASE" && "$TDD_PHASE" != "null" ]]; then
        case "$TDD_PHASE" in
            "red"|"RED")
                PHASE_DISPLAY="🔴 RED"
                ;;
            "green"|"GREEN")
                PHASE_DISPLAY="🟢 GREEN"
                ;;
            "refactor"|"REFACTOR")
                PHASE_DISPLAY="🔵 REFACTOR"
                ;;
            *)
                PHASE_DISPLAY="$TDD_PHASE"
                ;;
        esac
        # Add progress if available
        if [[ -n "$PROGRESS" && "$PROGRESS" != "null" ]]; then
            PHASE_DISPLAY="$PHASE_DISPLAY $PROGRESS"
        fi
        OSS_STATUS=" | $PHASE_DISPLAY"
    elif [[ -n "$CURRENT_CMD" && "$CURRENT_CMD" != "null" ]]; then
        OSS_STATUS=" | 🤖 $CURRENT_CMD"
        # Add progress if available
        if [[ -n "$PROGRESS" && "$PROGRESS" != "null" ]]; then
            OSS_STATUS="$OSS_STATUS $PROGRESS"
        fi
    fi

    # Add supervisor status indicator
    if [[ "$SUPERVISOR" == "intervening" ]]; then
        OSS_STATUS="$OSS_STATUS ⚡"
    elif [[ "$SUPERVISOR" == "watching" ]]; then
        OSS_STATUS="$OSS_STATUS ✓"
    fi
fi

# === QUEUE STATUS ===
QUEUE_FILE="${HOME}/.oss/queue.json"
QUEUE_DISPLAY=""

if [[ -f "$QUEUE_FILE" ]]; then
    # Count critical pending tasks
    CRITICAL_COUNT=$(jq '[.tasks[] | select(.status == "pending" and .priority == "critical")] | length' "$QUEUE_FILE" 2>/dev/null)
    # Count all pending tasks
    PENDING_COUNT=$(jq '[.tasks[] | select(.status == "pending")] | length' "$QUEUE_FILE" 2>/dev/null)

    if [[ -n "$CRITICAL_COUNT" && "$CRITICAL_COUNT" != "null" && "$CRITICAL_COUNT" -gt 0 ]]; then
        QUEUE_DISPLAY=" 🚨$CRITICAL_COUNT"
    elif [[ -n "$PENDING_COUNT" && "$PENDING_COUNT" != "null" && "$PENDING_COUNT" -gt 0 ]]; then
        QUEUE_DISPLAY=" 📋$PENDING_COUNT"
    fi
fi

# === GIT BRANCH ===
GIT_BRANCH=""
if git rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git branch --show-current 2>/dev/null)
    if [[ -n "$BRANCH" ]]; then
        if [[ "$BRANCH" == "master" || "$BRANCH" == "main" ]]; then
            # On main/master - show warning if OSS is active
            GIT_BRANCH=" | ⚠️ $BRANCH"
        else
            GIT_BRANCH=" | 🌿 $BRANCH"
        fi
    fi
fi

# === OUTPUT ===
# Format: [Model] Dir | Branch | OSS Health | TDD Phase Progress Supervisor | Issue
echo "[$MODEL] $CURRENT_DIR$GIT_BRANCH | $OSS_HEALTH$OSS_STATUS$ISSUE_DISPLAY$QUEUE_DISPLAY"
