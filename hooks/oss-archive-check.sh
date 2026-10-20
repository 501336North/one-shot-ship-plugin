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

_AC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$_AC_DIR/oss-safe-path.sh" ]]; then source "$_AC_DIR/oss-safe-path.sh"; else oss_safe_mkdir() { return 1; }; oss_safe_target() { return 1; }; oss_valid_workflow_name() { return 1; }; oss_refuse_unsafe() { echo "oss: refusing unsafe .oss path ${1:-} (oss-safe-path.sh missing)" >&2; }; fi  # ADR-1 write guard

DRY_RUN=false
LIST_ONLY=false
PROJECT_DIR=""

# Parse arguments
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            ;;
        --list)
            LIST_ONLY=true
            ;;
        --project-dir=*)
            PROJECT_DIR="${arg#*=}"
            ;;
    esac
done

# Not specified: the project this runs in (oss_resolve_project, the shared rule; never current-project)
if [[ -z "$PROJECT_DIR" ]] && declare -F oss_resolve_project >/dev/null; then
    oss_resolve_project; PROJECT_DIR="$_OSS_PROJ"
fi

# Resolve dev docs path with project-local priority
# Priority: 1) Project .oss/dev/, 2) Project dev/, 3) Global ~/.oss/dev/
resolve_dev_docs_path() {
    local project_dir="$1"

    # Priority 1: Project .oss/dev/
    if [[ -n "$project_dir" && -d "$project_dir/.oss/dev/active" ]]; then
        echo "$project_dir/.oss/dev"
        return
    fi

    # Priority 2: Project dev/ (backward compatibility)
    if [[ -n "$project_dir" && -d "$project_dir/dev/active" ]]; then
        echo "$project_dir/dev"
        return
    fi

    # Priority 3: Global ~/.oss/dev/
    echo "$HOME/.oss/dev"
}

DEV_DOCS_BASE=$(resolve_dev_docs_path "$PROJECT_DIR")
DEV_ACTIVE="$DEV_DOCS_BASE/active"
DEV_COMPLETED="$DEV_DOCS_BASE/completed"

# Check if dev/active exists
if [[ ! -d "$DEV_ACTIVE" ]]; then
    echo "No dev/active/ directory found at $DEV_ACTIVE"
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

    # Create completed directory if needed - through the guard (ADR-1): a cloned repo's
    # committed dev/active or dev/completed link must not move dev docs outside the project
    # (e.g. into ~/.claude/commands, where they would become global slash commands).
    local guard_root="$HOME" rel_active rel_completed
    if [[ -n "$PROJECT_DIR" && "$DEV_DOCS_BASE" == "$PROJECT_DIR"/* ]]; then guard_root="$PROJECT_DIR"; fi
    rel_active="${DEV_ACTIVE#"$guard_root"/}"
    rel_completed="${DEV_COMPLETED#"$guard_root"/}"
    if ! oss_safe_mkdir "$guard_root" "$rel_active" || ! oss_safe_mkdir "$guard_root" "$rel_completed"; then
        oss_refuse_unsafe "$rel_completed"
        return 1
    fi

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
    feature_dir="${feature_dir%/}"
    [[ -L "$feature_dir" ]] && continue   # a committed link: never move what it points at
    if [[ -d "$feature_dir" ]]; then
        if is_feature_complete "$feature_dir"; then
            archive_feature "$feature_dir" || continue   # refused: not archived, not counted
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
