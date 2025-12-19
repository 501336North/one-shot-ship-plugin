#!/bin/bash
# OSS Dev Workflow - Claude Code Status Line Script
#
# Shows workflow status in Claude Code status line.
# Reads from ~/.oss/workflow-state.json (written by workflow commands)
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

# Check for active OSS workflow status
OSS_STATUS=""
WORKFLOW_FILE="${HOME}/.oss/workflow-state.json"

if [[ -f "$WORKFLOW_FILE" ]]; then
    CURRENT_CMD=$(jq -r '.currentCommand // .activeStep // ""' "$WORKFLOW_FILE" 2>/dev/null)
    TDD_PHASE=$(jq -r '.tddPhase // ""' "$WORKFLOW_FILE" 2>/dev/null)
    SUPERVISOR=$(jq -r '.supervisor // ""' "$WORKFLOW_FILE" 2>/dev/null)

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
        OSS_STATUS=" | $PHASE_DISPLAY"
    elif [[ -n "$CURRENT_CMD" && "$CURRENT_CMD" != "null" ]]; then
        OSS_STATUS=" | 🤖 $CURRENT_CMD"
    fi

    # Add supervisor status indicator
    if [[ "$SUPERVISOR" == "intervening" ]]; then
        OSS_STATUS="$OSS_STATUS ⚡"
    elif [[ "$SUPERVISOR" == "watching" ]]; then
        OSS_STATUS="$OSS_STATUS ✓"
    fi
fi

# Check git branch
GIT_BRANCH=""
if git rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git branch --show-current 2>/dev/null)
    if [[ -n "$BRANCH" ]]; then
        if [[ "$BRANCH" == "master" || "$BRANCH" == "main" ]]; then
            GIT_BRANCH=" | $BRANCH"
        else
            GIT_BRANCH=" | 🌿 $BRANCH"
        fi
    fi
fi

echo "[$MODEL] $CURRENT_DIR$GIT_BRANCH$OSS_STATUS"
