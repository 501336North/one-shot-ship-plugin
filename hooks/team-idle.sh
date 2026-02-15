#!/bin/bash
# OSS Agent Teams - Teammate Idle Handler
# Triggered on: TeammateIdle (when an agent has no current task)
# Assigns next unblocked task or triggers reconciliation.
#
# Exit codes:
#   0 = No action needed (agent stays idle)
#   2 = Feedback sent to agent (task assignment or reconciliation)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_SCRIPT="$SCRIPT_DIR/oss-log.sh"

# --- Hook Logging ---
if [[ -x "$LOG_SCRIPT" ]]; then
    "$LOG_SCRIPT" hook team-idle START
fi

# Read teammate info from stdin (Claude Code passes JSON)
TEAMMATE_INPUT=$(cat)

# Only run in git repositories
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if [[ -x "$LOG_SCRIPT" ]]; then
        "$LOG_SCRIPT" hook team-idle COMPLETE
    fi
    exit 0
fi

# Check if PROGRESS.md exists and has pending tasks
PROGRESS_FILE=""
for dir in .oss/dev/active/*/; do
    if [[ -f "${dir}PROGRESS.md" ]]; then
        PROGRESS_FILE="${dir}PROGRESS.md"
        break
    fi
done

if [[ -z "$PROGRESS_FILE" ]]; then
    if [[ -x "$LOG_SCRIPT" ]]; then
        "$LOG_SCRIPT" hook team-idle "no active feature found"
    fi
    exit 0
fi

# Count pending and completed tasks
PENDING=$(grep -c '^\- \[ \]' "$PROGRESS_FILE" 2>/dev/null || echo "0")
COMPLETED=$(grep -c '^\- \[x\]' "$PROGRESS_FILE" 2>/dev/null || echo "0")
TOTAL=$((PENDING + COMPLETED))

if [[ "$PENDING" -eq 0 && "$TOTAL" -gt 0 ]]; then
    # All tasks complete — trigger reconciliation
    if [[ -x "$LOG_SCRIPT" ]]; then
        "$LOG_SCRIPT" hook team-idle "triggering reconciliation"
    fi
    echo "All parallel tasks are complete. Run the full test suite to validate the merged result, then reconcile any shared file conflicts."
    exit 2
fi

if [[ "$PENDING" -gt 0 ]]; then
    # Pending tasks remain — assign next
    NEXT_TASK=$(grep '^\- \[ \]' "$PROGRESS_FILE" | head -1 | sed 's/^- \[ \] //')
    if [[ -n "$NEXT_TASK" ]]; then
        if [[ -x "$LOG_SCRIPT" ]]; then
            "$LOG_SCRIPT" hook team-idle "assigning: $NEXT_TASK"
        fi
        echo "Pick up the next unblocked task: $NEXT_TASK"
        exit 2
    fi
fi

# No action needed
if [[ -x "$LOG_SCRIPT" ]]; then
    "$LOG_SCRIPT" hook team-idle COMPLETE
fi
exit 0
