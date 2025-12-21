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

# Security: Validate project path to prevent path traversal attacks
# Returns validated canonical path or empty string if invalid
validate_project_path() {
    local project_path="$1"

    # Reject empty paths
    [[ -z "$project_path" ]] && return 1

    # Must be absolute path
    [[ "$project_path" != /* ]] && return 1

    # Canonicalize with realpath (resolves symlinks)
    local canonical
    canonical=$(realpath "$project_path" 2>/dev/null) || return 1
    [[ -z "$canonical" ]] && return 1

    # Must be a directory
    [[ ! -d "$canonical" ]] && return 1

    # Security: Must be within $HOME or user's temp directory
    local home_resolved
    home_resolved=$(realpath "$HOME" 2>/dev/null) || return 1

    # Check if in home
    local in_home=false
    [[ "$canonical" == "$home_resolved" || "$canonical" == "$home_resolved"/* ]] && in_home=true

    # Check if in temp directory (for tests)
    local in_tmp=false
    if [[ -n "$TMPDIR" ]]; then
        local tmp_resolved
        tmp_resolved=$(realpath "$TMPDIR" 2>/dev/null) || true
        [[ -n "$tmp_resolved" && ("$canonical" == "$tmp_resolved" || "$canonical" == "$tmp_resolved"/*) ]] && in_tmp=true
    fi
    # Also check /private/tmp and /private/var/folders (macOS temp locations)
    [[ "$canonical" == /private/tmp/* || "$canonical" == /private/var/folders/* ]] && in_tmp=true

    if [[ "$in_home" == "false" && "$in_tmp" == "false" ]]; then
        return 1
    fi

    echo "$canonical"
    return 0
}

# Read Claude Code context from stdin
INPUT=$(cat)

# Extract model name and directory using jq
if ! command -v jq &>/dev/null; then
    echo "[jq required]"
    exit 0
fi

MODEL=$(echo "$INPUT" | jq -r '.model.display_name // "Claude"')
# Extract full path for project detection, basename for display
WORKSPACE_DIR=$(echo "$INPUT" | jq -r '.workspace.current_dir // ""')
CURRENT_DIR=$(echo "$WORKSPACE_DIR" | sed 's|.*/||')

# === OSS HEALTH STATUS ===
# Check for active IRON LAW violations DYNAMICALLY
# LAW#4: Agent must never be on main/master branch
OSS_HEALTH="✅"  # Default: all good

# We'll check LAW#4 dynamically after determining the project directory
# Other violations can still come from the state file
IRON_LAW_FILE="${HOME}/.oss/iron-law-state.json"
ACTIVE_LAW4_VIOLATION=false  # Will be set later after git check

# === WORKFLOW STATUS ===
OSS_STATUS=""
ISSUE_DISPLAY=""

# Get project directory - prefer stdin (multi-session safe) over ~/.oss/current-project
# Priority: 1) workspace.current_dir from stdin, 2) ~/.oss/current-project (legacy fallback)
CURRENT_PROJECT=""
if [[ -n "$WORKSPACE_DIR" ]]; then
    # Use workspace dir from Claude Code stdin (multi-session safe)
    CURRENT_PROJECT=$(validate_project_path "$WORKSPACE_DIR") || CURRENT_PROJECT=""
fi
if [[ -z "$CURRENT_PROJECT" ]]; then
    # Fallback to ~/.oss/current-project (legacy, not multi-session safe)
    RAW_PROJECT=$(cat ~/.oss/current-project 2>/dev/null | tr -d '[:space:]')
    if [[ -n "$RAW_PROJECT" ]]; then
        CURRENT_PROJECT=$(validate_project_path "$RAW_PROJECT") || CURRENT_PROJECT=""
    fi
fi

# Use project-local state if available, otherwise fall back to global
if [[ -n "$CURRENT_PROJECT" && -f "$CURRENT_PROJECT/.oss/workflow-state.json" ]]; then
    WORKFLOW_FILE="$CURRENT_PROJECT/.oss/workflow-state.json"
else
    WORKFLOW_FILE="${HOME}/.oss/workflow-state.json"
fi

if [[ -f "$WORKFLOW_FILE" ]]; then
    CURRENT_CMD=$(jq -r '.currentCommand // .activeStep // ""' "$WORKFLOW_FILE" 2>/dev/null)
    TDD_PHASE=$(jq -r '.tddPhase // ""' "$WORKFLOW_FILE" 2>/dev/null)
    SUPERVISOR=$(jq -r '.supervisor // ""' "$WORKFLOW_FILE" 2>/dev/null)
    PROGRESS=$(jq -r '.progress // ""' "$WORKFLOW_FILE" 2>/dev/null)
    CURRENT_TASK=$(jq -r '.currentTask // ""' "$WORKFLOW_FILE" 2>/dev/null)

    # Read active agent info (for delegated agent work)
    ACTIVE_AGENT_TYPE=$(jq -r '.activeAgent.type // ""' "$WORKFLOW_FILE" 2>/dev/null)

    # Read message for status line display
    MESSAGE=$(jq -r '.message // ""' "$WORKFLOW_FILE" 2>/dev/null)

    # Read nextCommand for workflow progression display
    NEXT_CMD=$(jq -r '.nextCommand // ""' "$WORKFLOW_FILE" 2>/dev/null)

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

    # Format workflow/TDD display
    # Priority: currentCommand → nextCommand > TDD phase > currentCommand alone
    if [[ -n "$CURRENT_CMD" && "$CURRENT_CMD" != "null" && -n "$NEXT_CMD" && "$NEXT_CMD" != "null" ]]; then
        # Both current and next: show "plan → build" format
        OSS_STATUS=" | $CURRENT_CMD → $NEXT_CMD"
    elif [[ -n "$NEXT_CMD" && "$NEXT_CMD" != "null" && ( -z "$CURRENT_CMD" || "$CURRENT_CMD" == "null" ) ]]; then
        # Only next command: show "→ ideate" format (fresh start)
        OSS_STATUS=" | → $NEXT_CMD"
    elif [[ -n "$TDD_PHASE" && "$TDD_PHASE" != "null" ]]; then
        # TDD phase display - emoji only for compact status line
        case "$TDD_PHASE" in
            "red"|"RED")
                PHASE_DISPLAY="🔴"
                ;;
            "green"|"GREEN")
                PHASE_DISPLAY="🟢"
                ;;
            "refactor"|"REFACTOR")
                PHASE_DISPLAY="🔄"
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
        # Only current command (no next, e.g., during ship)
        OSS_STATUS=" | $CURRENT_CMD"
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
    elif [[ "$SUPERVISOR" == "idle" ]]; then
        OSS_STATUS="$OSS_STATUS 💾"
    fi

    # Add active agent display (when delegated work is happening)
    if [[ -n "$ACTIVE_AGENT_TYPE" && "$ACTIVE_AGENT_TYPE" != "null" ]]; then
        OSS_STATUS="$OSS_STATUS 🤖 $ACTIVE_AGENT_TYPE"
    fi
fi

# === QUEUE STATUS ===
# Use project-local queue if available
if [[ -n "$CURRENT_PROJECT" && -f "$CURRENT_PROJECT/.oss/queue.json" ]]; then
    QUEUE_FILE="$CURRENT_PROJECT/.oss/queue.json"
else
    QUEUE_FILE="${HOME}/.oss/queue.json"
fi
QUEUE_DISPLAY=""

if [[ -f "$QUEUE_FILE" ]]; then
    # Count critical pending tasks
    CRITICAL_COUNT=$(jq '[.tasks[] | select(.status == "pending" and .priority == "critical")] | length' "$QUEUE_FILE" 2>/dev/null)
    # Count all pending tasks
    PENDING_COUNT=$(jq '[.tasks[] | select(.status == "pending")] | length' "$QUEUE_FILE" 2>/dev/null)

    if [[ -n "$CRITICAL_COUNT" && "$CRITICAL_COUNT" != "null" && "$CRITICAL_COUNT" -gt 0 ]]; then
        # Get first critical task description
        TOP_TASK=$(jq -r '[.tasks[] | select(.status == "pending" and .priority == "critical")][0].description // ""' "$QUEUE_FILE" 2>/dev/null)
        # Truncate to 20 chars with ellipsis if needed
        if [[ ${#TOP_TASK} -gt 20 ]]; then
            TOP_TASK="${TOP_TASK:0:20}..."
        fi
        QUEUE_DISPLAY=" 🚨$CRITICAL_COUNT: $TOP_TASK"
    elif [[ -n "$PENDING_COUNT" && "$PENDING_COUNT" != "null" && "$PENDING_COUNT" -gt 0 ]]; then
        # Get first pending task description
        TOP_TASK=$(jq -r '[.tasks[] | select(.status == "pending")][0].description // ""' "$QUEUE_FILE" 2>/dev/null)
        # Truncate to 20 chars with ellipsis if needed
        if [[ ${#TOP_TASK} -gt 20 ]]; then
            TOP_TASK="${TOP_TASK:0:20}..."
        fi
        QUEUE_DISPLAY=" 📋$PENDING_COUNT: $TOP_TASK"
    fi
fi

# === MESSAGE DISPLAY ===
MESSAGE_DISPLAY=""
if [[ -n "$MESSAGE" && "$MESSAGE" != "null" && "$MESSAGE" != "" ]]; then
    MESSAGE_DISPLAY=" 📣 $MESSAGE"
fi

# === GIT BRANCH ===
# Use workspace.current_dir from stdin for git commands (multi-session safe)
GIT_BRANCH=""
GIT_DIR_FOR_CHECK="."
if [[ -n "$CURRENT_PROJECT" ]]; then
    GIT_DIR_FOR_CHECK="$CURRENT_PROJECT"
fi

if git -C "$GIT_DIR_FOR_CHECK" rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git -C "$GIT_DIR_FOR_CHECK" branch --show-current 2>/dev/null)
    if [[ -n "$BRANCH" ]]; then
        if [[ "$BRANCH" == "master" || "$BRANCH" == "main" ]]; then
            # On main/master - show warning if OSS is active
            GIT_BRANCH=" | ⚠️ $BRANCH"
            # LAW#4 violation: agent is on protected branch
            ACTIVE_LAW4_VIOLATION=true
        else
            GIT_BRANCH=" | 🌿 $BRANCH"
        fi
    fi
fi

# === FINALIZE HEALTH STATUS ===
# Set OSS_HEALTH based on dynamic violations (LAW#4 from branch check)
# AND any other violations from state file (non-LAW#4)
if [[ "$ACTIVE_LAW4_VIOLATION" == "true" ]]; then
    OSS_HEALTH="⛔ LAW#4"
elif [[ -f "$IRON_LAW_FILE" ]]; then
    # Check for other unresolved violations (not LAW#4, since we check that dynamically)
    # Note: .law can be number or string, so compare both ways
    OTHER_VIOLATIONS=$(jq '[.violations[] | select(.resolved == null or .resolved == "null") | select(.law != 4 and .law != "4")] | length' "$IRON_LAW_FILE" 2>/dev/null)
    if [[ -n "$OTHER_VIOLATIONS" && "$OTHER_VIOLATIONS" != "null" && "$OTHER_VIOLATIONS" -gt 0 ]]; then
        VIOLATED_LAW=$(jq -r '[.violations[] | select(.resolved == null or .resolved == "null") | select(.law != 4 and .law != "4")][0].law // ""' "$IRON_LAW_FILE" 2>/dev/null)
        OSS_HEALTH="⛔ LAW#$VIOLATED_LAW"
    fi
fi

# === OUTPUT ===
# Format: OSS Health [Model] Dir | Branch | TDD Phase Progress Supervisor | Issue | Queue | Message
echo "$OSS_HEALTH [$MODEL] $CURRENT_DIR$GIT_BRANCH$OSS_STATUS$ISSUE_DISPLAY$QUEUE_DISPLAY$MESSAGE_DISPLAY"
