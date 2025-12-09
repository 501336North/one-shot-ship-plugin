#!/bin/bash
# oss-archive-check.sh - Check dev/active/ for completed features and archive them
#
# Usage:
#   oss-archive-check.sh              # Check and archive completed features
#   oss-archive-check.sh --dry-run    # Only show what would be archived
#   oss-archive-check.sh --list       # List features and their status
#
# Called by: /oss:plan, /oss:ship
#
# Completion Detection Patterns:
# 1. PROGRESS.md contains "Current Phase: ship" AND has merged/complete status
# 2. PROGRESS.md contains "Current Phase:" with (COMPLETE) suffix
# 3. PROGRESS.md contains "Current Phase: completed" or "Current Phase: complete"
# 4. All tasks in PROGRESS.md are checked off [x] (100% complete)

set -euo pipefail

DRY_RUN=false
LIST_ONLY=false
DEV_ACTIVE="$HOME/.oss/dev/active"
DEV_COMPLETED="$HOME/.oss/dev/completed"

# Parse arguments
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            ;;
        --list)
            LIST_ONLY=true
            ;;
    esac
done

# Check if dev/active exists
if [[ ! -d "$DEV_ACTIVE" ]]; then
    echo "No dev/active/ directory found"
    exit 0
fi

# Function to check if a feature is complete
is_feature_complete() {
    local feature_dir="$1"
    local progress_file="$feature_dir/PROGRESS.md"

    if [[ ! -f "$progress_file" ]]; then
        return 1  # No PROGRESS.md = not complete
    fi

    local content
    content=$(cat "$progress_file")

    # Pattern 1: "Current Phase: ship" with merged/complete indicators
    if echo "$content" | grep -qi "Current Phase:.*ship" && \
       echo "$content" | grep -qi "merged\|shipped\|complete"; then
        return 0
    fi

    # Pattern 2: "Current Phase:" with (COMPLETE) suffix (case insensitive)
    if echo "$content" | grep -qiE "Current Phase:.*\(COMPLETE\)"; then
        return 0
    fi

    # Pattern 3: "Current Phase: completed" or "Current Phase: complete" (with or without emoji)
    if echo "$content" | grep -qiE "Current Phase:.*complete"; then
        return 0
    fi

    # Pattern 4: "Current Phase:" contains emoji checkmark (✅) and COMPLETE
    if echo "$content" | grep -q "Current Phase:.*✅.*COMPLETE\|Current Phase:.*COMPLETE.*✅"; then
        return 0
    fi

    # Pattern 5: "Current Phase:" just has ✅ followed by anything suggesting done
    if echo "$content" | grep -q "Current Phase:.*✅"; then
        return 0
    fi

    # Pattern 4: All tasks checked off
    # Count total tasks: lines starting with "- [ ]" or "- [x]"
    local total_tasks
    local completed_tasks
    total_tasks=$(echo "$content" | grep -cE "^\s*-\s*\[[ x]\]" 2>/dev/null || true)
    completed_tasks=$(echo "$content" | grep -cE "^\s*-\s*\[x\]" 2>/dev/null || true)

    # Default to 0 if empty
    total_tasks=${total_tasks:-0}
    completed_tasks=${completed_tasks:-0}

    if [[ "$total_tasks" -gt 0 ]] && [[ "$total_tasks" == "$completed_tasks" ]]; then
        return 0
    fi

    return 1  # Not complete
}

# Function to get feature status
get_feature_status() {
    local feature_dir="$1"
    local progress_file="$feature_dir/PROGRESS.md"

    if [[ ! -f "$progress_file" ]]; then
        echo "no-progress-file"
        return
    fi

    # Extract current phase
    local phase
    phase=$(grep -i "Current Phase:" "$progress_file" | head -1 | sed 's/.*Current Phase:\s*//' | tr -d '#*')

    if [[ -z "$phase" ]]; then
        echo "unknown"
    else
        echo "$phase"
    fi
}

# Function to archive a feature
archive_feature() {
    local feature_dir="$1"
    local feature_name
    feature_name=$(basename "$feature_dir")
    local timestamp
    timestamp=$(date +%Y%m%d)
    local archive_dir="$DEV_COMPLETED/${feature_name}-${timestamp}"

    if $DRY_RUN; then
        echo "  Would archive: $feature_name → $archive_dir"
        return 0
    fi

    # Create completed directory if needed
    mkdir -p "$DEV_COMPLETED"

    # Handle duplicate archives (same day)
    if [[ -d "$archive_dir" ]]; then
        local counter=1
        while [[ -d "${archive_dir}-${counter}" ]]; do
            ((counter++))
        done
        archive_dir="${archive_dir}-${counter}"
    fi

    # Move to completed
    mv "$feature_dir" "$archive_dir"
    echo "  ✓ Archived: $feature_name → $(basename "$archive_dir")"
}

# Main logic
if $LIST_ONLY; then
    echo "Feature Status:"
    echo "───────────────────────────────────────"
    for feature_dir in "$DEV_ACTIVE"/*/; do
        if [[ -d "$feature_dir" ]]; then
            feature_name=$(basename "$feature_dir")
            status=$(get_feature_status "$feature_dir")
            if is_feature_complete "$feature_dir"; then
                echo "  ✅ $feature_name - $status (READY TO ARCHIVE)"
            else
                echo "  🔄 $feature_name - $status"
            fi
        fi
    done
    exit 0
fi

# Check for and archive completed features
archived_count=0
for feature_dir in "$DEV_ACTIVE"/*/; do
    if [[ -d "$feature_dir" ]]; then
        if is_feature_complete "$feature_dir"; then
            archive_feature "$feature_dir"
            ((archived_count++))
        fi
    fi
done

if [[ $archived_count -eq 0 ]]; then
    if $DRY_RUN; then
        echo "No completed features to archive"
    fi
else
    if $DRY_RUN; then
        echo "Would archive $archived_count feature(s)"
    else
        echo "Archived $archived_count feature(s)"
    fi
fi
