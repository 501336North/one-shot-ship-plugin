#!/bin/bash
# OSS Dev Workflow - Claude Code Status Line Script
#
# Displays workflow status in Claude Code status line with clear section separation.
# Each section is independent and separated by " | ".
#
# Section Layout:
#   Health | [Model] Project | Branch | Workflow | Supervisor | Queue | Notification
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
# Output: Single line status text with sections separated by " | "

# =============================================================================
# Security: Validate project path to prevent path traversal attacks
# =============================================================================
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

# =============================================================================
# Read input and setup
# =============================================================================

# Read Claude Code context from stdin
INPUT=$(cat)

# Check for jq dependency
if ! command -v jq &>/dev/null; then
    echo "[jq required]"
    exit 0
fi

# Extract model name and directory using jq
MODEL=$(echo "$INPUT" | jq -r '.model.display_name // "Claude"')
WORKSPACE_DIR=$(echo "$INPUT" | jq -r '.workspace.current_dir // ""')
PROJECT_NAME=$(basename "$WORKSPACE_DIR" 2>/dev/null || echo "")

# Determine project directory for state files
CURRENT_PROJECT=""
if [[ -n "$WORKSPACE_DIR" ]]; then
    CURRENT_PROJECT=$(validate_project_path "$WORKSPACE_DIR") || CURRENT_PROJECT=""
fi
if [[ -z "$CURRENT_PROJECT" ]]; then
    # Fallback to ~/.oss/current-project (legacy)
    RAW_PROJECT=$(cat ~/.oss/current-project 2>/dev/null | tr -d '[:space:]')
    if [[ -n "$RAW_PROJECT" ]]; then
        CURRENT_PROJECT=$(validate_project_path "$RAW_PROJECT") || CURRENT_PROJECT=""
    fi
fi

# Determine state file locations
if [[ -n "$CURRENT_PROJECT" && -f "$CURRENT_PROJECT/.oss/workflow-state.json" ]]; then
    WORKFLOW_FILE="$CURRENT_PROJECT/.oss/workflow-state.json"
else
    WORKFLOW_FILE="${HOME}/.oss/workflow-state.json"
fi

if [[ -n "$CURRENT_PROJECT" && -f "$CURRENT_PROJECT/.oss/queue.json" ]]; then
    QUEUE_FILE="$CURRENT_PROJECT/.oss/queue.json"
else
    QUEUE_FILE="${HOME}/.oss/queue.json"
fi

IRON_LAW_FILE="${HOME}/.oss/iron-law-state.json"

# =============================================================================
# Read state once (atomic read for consistency)
# =============================================================================

STATE="{}"
if [[ -f "$WORKFLOW_FILE" ]]; then
    STATE=$(cat "$WORKFLOW_FILE" 2>/dev/null || echo '{}')
fi

# =============================================================================
# Section 1: Health (IRON LAW violations)
# =============================================================================
# Priority: Check LAW#4 dynamically, then consolidated state, then iron-law-state.json
# =============================================================================
compute_health() {
    local health="✅"
    local law4_violation=false

    # Always check LAW#4 dynamically (must not be on main/master)
    if [[ -n "$CURRENT_PROJECT" ]]; then
        local branch
        branch=$(git -C "$CURRENT_PROJECT" branch --show-current 2>/dev/null)
        if [[ "$branch" == "main" || "$branch" == "master" ]]; then
            law4_violation=true
        fi
    fi

    if [[ "$law4_violation" == "true" ]]; then
        health="⛔ LAW#4"
    else
        # Try consolidated state first (health in workflow-state.json)
        local health_status violated_law
        health_status=$(echo "$STATE" | jq -r '.health.status // ""' 2>/dev/null)
        violated_law=$(echo "$STATE" | jq -r '.health.violatedLaw // ""' 2>/dev/null)

        if [[ "$health_status" == "violation" && -n "$violated_law" && "$violated_law" != "null" ]]; then
            health="⛔ LAW#$violated_law"
        elif [[ -f "$IRON_LAW_FILE" ]]; then
            # Fall back to iron-law-state.json (legacy/backup)
            local other_violations
            other_violations=$(jq '[.violations[] | select(.resolved == null or .resolved == "null") | select(.law != 4 and .law != "4")] | length' "$IRON_LAW_FILE" 2>/dev/null)
            if [[ -n "$other_violations" && "$other_violations" != "null" && "$other_violations" -gt 0 ]]; then
                violated_law=$(jq -r '[.violations[] | select(.resolved == null or .resolved == "null") | select(.law != 4 and .law != "4")][0].law // ""' "$IRON_LAW_FILE" 2>/dev/null)
                health="⛔ LAW#$violated_law"
            fi
        fi
    fi

    echo "$health"
}

# =============================================================================
# Section 2: Model + Project
# =============================================================================
compute_model_project() {
    echo "[$MODEL] $PROJECT_NAME"
}

# =============================================================================
# Section 3: Git Branch
# =============================================================================
compute_branch() {
    local branch=""
    local git_dir="."

    if [[ -n "$CURRENT_PROJECT" ]]; then
        git_dir="$CURRENT_PROJECT"
    fi

    if git -C "$git_dir" rev-parse --git-dir > /dev/null 2>&1; then
        branch=$(git -C "$git_dir" branch --show-current 2>/dev/null)
        if [[ -n "$branch" ]]; then
            if [[ "$branch" == "master" || "$branch" == "main" ]]; then
                echo "⚠️ $branch"
            else
                echo "🌿 $branch"
            fi
            return
        fi
    fi

    echo ""
}

# =============================================================================
# Section 4: Workflow (command + TDD phase + progress)
# =============================================================================
# Priority order for workflow display:
#   1. TDD phase with progress (🔴 3/8) - most specific, shows current work
#   2. Current command with progress (build 3/8) - active command
#   3. Command flow (build → ship) - shows transition
#   4. Next command suggestion (→ plan) - idle hint
#
# Format examples:
#   During TDD:     🔴 3/8
#   During build:   build 5/10
#   Transition:     build → ship
#   Idle:           → plan
# =============================================================================
compute_workflow() {
    local current_cmd next_cmd tdd_phase progress last_cmd workflow_complete

    current_cmd=$(echo "$STATE" | jq -r '.currentCommand // .activeStep // ""' 2>/dev/null)
    next_cmd=$(echo "$STATE" | jq -r '.nextCommand // ""' 2>/dev/null)
    last_cmd=$(echo "$STATE" | jq -r '.lastCommand // ""' 2>/dev/null)
    workflow_complete=$(echo "$STATE" | jq -r '.workflowComplete // ""' 2>/dev/null)
    tdd_phase=$(echo "$STATE" | jq -r '.tddPhase // ""' 2>/dev/null)
    progress=$(echo "$STATE" | jq -r '.progress // ""' 2>/dev/null)

    # Priority 0: Check if workflow is complete (show "ship → DONE")
    if [[ "$workflow_complete" == "true" ]]; then
        if [[ -n "$last_cmd" && "$last_cmd" != "null" ]]; then
            echo "$last_cmd → DONE"
        else
            echo "→ DONE"
        fi
        return
    fi

    # Priority 1: TDD phase (most specific - shows TDD: RED/GREEN/REFACTOR)
    if [[ -n "$tdd_phase" && "$tdd_phase" != "null" ]]; then
        local phase_emoji
        case "$tdd_phase" in
            "red"|"RED") phase_emoji="🔴" ;;
            "green"|"GREEN") phase_emoji="🟢" ;;
            "refactor"|"REFACTOR") phase_emoji="🔄" ;;
            *) phase_emoji="$tdd_phase" ;;
        esac
        if [[ -n "$progress" && "$progress" != "null" ]]; then
            echo "TDD: $phase_emoji $progress"
        else
            echo "TDD: $phase_emoji"
        fi
        return
    fi

    # Priority 2: Current command with progress
    if [[ -n "$current_cmd" && "$current_cmd" != "null" ]]; then
        if [[ -n "$progress" && "$progress" != "null" ]]; then
            echo "$current_cmd $progress"
        elif [[ -n "$next_cmd" && "$next_cmd" != "null" && "$next_cmd" != "$current_cmd" ]]; then
            # Only show arrow if next is different from current
            echo "$current_cmd → $next_cmd"
        else
            echo "$current_cmd"
        fi
        return
    fi

    # Priority 3: lastCommand → nextCommand (shows completed → next)
    if [[ -n "$last_cmd" && "$last_cmd" != "null" ]]; then
        if [[ -n "$next_cmd" && "$next_cmd" != "null" ]]; then
            echo "$last_cmd → $next_cmd"
        else
            echo "$last_cmd ✓"  # Completed, no next step
        fi
        return
    fi

    # Priority 4: Next command suggestion (idle state with no history)
    if [[ -n "$next_cmd" && "$next_cmd" != "null" ]]; then
        echo "→ $next_cmd"
        return
    fi

    echo ""
}

# =============================================================================
# Section 4b: Active Agent (separate from workflow for flexibility)
# =============================================================================
# Shows delegated work: 🤖 react-specialist
# =============================================================================
compute_agent() {
    local active_agent
    active_agent=$(echo "$STATE" | jq -r '.activeAgent.type // ""' 2>/dev/null)

    if [[ -n "$active_agent" && "$active_agent" != "null" ]]; then
        echo "🤖 $active_agent"
        return
    fi

    echo ""
}

# =============================================================================
# Section 5: Supervisor status
# =============================================================================
compute_supervisor() {
    local supervisor
    supervisor=$(echo "$STATE" | jq -r '.supervisor // ""' 2>/dev/null)

    case "$supervisor" in
        "intervening") echo "⚡" ;;
        "watching") echo "✓" ;;
        "idle") echo "" ;;  # Don't show anything when idle
        *) echo "" ;;
    esac
}

# =============================================================================
# Section 6: Queue (only if count > 0)
# =============================================================================
# Priority: Read from consolidated workflow-state.json first, fall back to queue.json
# =============================================================================
compute_queue() {
    local critical_count pending_count top_task

    # Try consolidated state first (queueSummary in workflow-state.json)
    critical_count=$(echo "$STATE" | jq -r '.queueSummary.criticalCount // ""' 2>/dev/null)
    pending_count=$(echo "$STATE" | jq -r '.queueSummary.pendingCount // ""' 2>/dev/null)
    top_task=$(echo "$STATE" | jq -r '.queueSummary.topTask // ""' 2>/dev/null)

    # If consolidated state has data, use it
    if [[ -n "$critical_count" && "$critical_count" != "null" && "$critical_count" -gt 0 ]]; then
        if [[ -n "$top_task" && "$top_task" != "null" && ${#top_task} -gt 20 ]]; then
            top_task="${top_task:0:20}..."
        fi
        echo "🚨$critical_count: ${top_task:-}"
        return
    fi

    if [[ -n "$pending_count" && "$pending_count" != "null" && "$pending_count" -gt 0 ]]; then
        if [[ -n "$top_task" && "$top_task" != "null" && ${#top_task} -gt 20 ]]; then
            top_task="${top_task:0:20}..."
        fi
        echo "📋$pending_count: ${top_task:-}"
        return
    fi

    # Fall back to queue.json file (legacy/backup)
    if [[ -f "$QUEUE_FILE" ]]; then
        critical_count=$(jq '[.tasks[] | select(.status == "pending" and .priority == "critical")] | length' "$QUEUE_FILE" 2>/dev/null)
        pending_count=$(jq '[.tasks[] | select(.status == "pending")] | length' "$QUEUE_FILE" 2>/dev/null)

        if [[ -n "$critical_count" && "$critical_count" != "null" && "$critical_count" -gt 0 ]]; then
            top_task=$(jq -r '[.tasks[] | select(.status == "pending" and .priority == "critical")][0].description // ""' "$QUEUE_FILE" 2>/dev/null)
            if [[ ${#top_task} -gt 20 ]]; then
                top_task="${top_task:0:20}..."
            fi
            echo "🚨$critical_count: $top_task"
            return
        fi

        if [[ -n "$pending_count" && "$pending_count" != "null" && "$pending_count" -gt 0 ]]; then
            top_task=$(jq -r '[.tasks[] | select(.status == "pending")][0].description // ""' "$QUEUE_FILE" 2>/dev/null)
            if [[ ${#top_task} -gt 20 ]]; then
                top_task="${top_task:0:20}..."
            fi
            echo "📋$pending_count: $top_task"
            return
        fi
    fi

    echo ""
}

# =============================================================================
# Section 7: Notification (non-sticky, auto-clears after expiry)
# =============================================================================
compute_notification() {
    local notification_msg expires_at

    notification_msg=$(echo "$STATE" | jq -r '.notification.message // ""' 2>/dev/null)
    expires_at=$(echo "$STATE" | jq -r '.notification.expiresAt // ""' 2>/dev/null)

    if [[ -z "$notification_msg" || "$notification_msg" == "null" ]]; then
        echo ""
        return
    fi

    if [[ -z "$expires_at" || "$expires_at" == "null" ]]; then
        echo ""
        return
    fi

    # Check if expired
    local expires_epoch now_epoch

    # Convert ISO timestamp to epoch
    # Note: JavaScript generates UTC timestamps ending with 'Z' (Zulu time)
    # We must parse them as UTC, not local time
    if [[ "$(uname)" == "Darwin" ]]; then
        # macOS: Use -u flag to interpret input as UTC (not local time)
        # Strip milliseconds and Z suffix: "2025-12-21T18:50:11.166Z" -> "2025-12-21T18:50:11"
        local timestamp_clean="${expires_at%%.*}"
        expires_epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "$timestamp_clean" "+%s" 2>/dev/null || echo "0")
    else
        # Linux: date -d handles ISO timestamps with Z suffix correctly
        expires_epoch=$(date -d "$expires_at" "+%s" 2>/dev/null || echo "0")
    fi

    now_epoch=$(date "+%s")

    if [[ "$expires_epoch" -le "$now_epoch" ]]; then
        # Expired - don't display
        echo ""
        return
    fi

    echo "📣 $notification_msg"
}

# =============================================================================
# Detect if in idle state (no active workflow)
# =============================================================================
is_idle_state() {
    local current_cmd active_agent tdd_phase

    current_cmd=$(echo "$STATE" | jq -r '.currentCommand // .activeStep // ""' 2>/dev/null)
    active_agent=$(echo "$STATE" | jq -r '.activeAgent.type // ""' 2>/dev/null)
    tdd_phase=$(echo "$STATE" | jq -r '.tddPhase // ""' 2>/dev/null)

    # Idle = no current command AND no active agent AND no TDD phase
    if [[ (-z "$current_cmd" || "$current_cmd" == "null") && \
          (-z "$active_agent" || "$active_agent" == "null") && \
          (-z "$tdd_phase" || "$tdd_phase" == "null") ]]; then
        return 0  # true - is idle
    fi
    return 1  # false - not idle
}

# =============================================================================
# Build status line with proper separators
# =============================================================================
# Section order (full active display):
#   health | [Model] project | branch | workflow | agent | supervisor | queue | notification
#
# Section order (minimal idle display):
#   health | branch | → next | 🚨 critical queue (if any) | notification
# =============================================================================
build_status_line() {
    local sections=()

    # Compute each section
    local health model_project branch workflow agent supervisor queue notification

    health=$(compute_health)
    model_project=$(compute_model_project)
    branch=$(compute_branch)
    workflow=$(compute_workflow)
    agent=$(compute_agent)
    supervisor=$(compute_supervisor)
    queue=$(compute_queue)
    notification=$(compute_notification)

    # Check if in idle state - show minimal display but always include Model+Project
    if is_idle_state; then
        # Minimal idle display: health | [Model] project | branch | → next (if available)
        [[ -n "$health" ]] && sections+=("$health")
        [[ -n "$model_project" ]] && sections+=("$model_project")  # Always show Model+Project
        [[ -n "$branch" ]] && sections+=("$branch")
        [[ -n "$workflow" ]] && sections+=("$workflow")  # Will be "→ next" or empty
        # Still show critical queue alerts even in idle
        if [[ -n "$queue" && "$queue" == *"🚨"* ]]; then
            sections+=("$queue")
        fi
        [[ -n "$notification" ]] && sections+=("$notification")
    else
        # Full active display: health | [Model] project | branch | workflow | agent | supervisor | queue | notification
        [[ -n "$health" ]] && sections+=("$health")
        [[ -n "$model_project" ]] && sections+=("$model_project")
        [[ -n "$branch" ]] && sections+=("$branch")
        [[ -n "$workflow" ]] && sections+=("$workflow")
        [[ -n "$agent" ]] && sections+=("$agent")
        [[ -n "$supervisor" ]] && sections+=("$supervisor")
        [[ -n "$queue" ]] && sections+=("$queue")
        [[ -n "$notification" ]] && sections+=("$notification")
    fi

    # Join with " | "
    local result=""
    local first=true
    for section in "${sections[@]}"; do
        if [[ "$first" == "true" ]]; then
            result="$section"
            first=false
        else
            result="$result | $section"
        fi
    done

    echo "$result"
}

# =============================================================================
# Output
# =============================================================================
build_status_line
