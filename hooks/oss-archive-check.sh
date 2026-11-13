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
# Completion rule (R-257 T13; D13, D14, AC-006.1): only a ship phase result archives a feature. Features with no
# results/ship.json are never moved; they are named once, on one "no phase result, move by hand" line. The rest go
# through ONE bounded `oss-phase-result.sh check ship --all` call (the archive rule in
# watcher/src/phase-results/archivable.ts), and only features it prints as `<feature> ok` move. A timeout or an
# error archives nothing. PROGRESS.md prose never decides.

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

# Features with and without a ship result (a link in dev/active is skipped: never move what it points at)
SHIP_CANDIDATES=()
NO_RESULT=()
for feature_dir in "$DEV_ACTIVE"/*/; do
    feature_dir="${feature_dir%/}"
    [[ -L "$feature_dir" || ! -d "$feature_dir" ]] && continue
    if [[ -e "$feature_dir/results/ship.json" || -L "$feature_dir/results/ship.json" ]]; then
        SHIP_CANDIDATES+=("$(basename "$feature_dir")")
    else
        NO_RESULT+=("$(basename "$feature_dir")")
    fi
done

# One bounded CLI call for all candidates: lines "<feature> ok" or "<feature> <reason>". Results live only in the
# project's .oss/dev, so other dev docs locations have nothing to check.
VERDICTS=""
if [[ ${#SHIP_CANDIDATES[@]} -gt 0 && -n "$PROJECT_DIR" && "$DEV_DOCS_BASE" == "$PROJECT_DIR/.oss/dev" \
      && -f "$_AC_DIR/oss-phase-result.sh" ]]; then
    source "$_AC_DIR/oss-phase-result.sh"
    VERDICTS=$(oss_phase_result_main check ship --all --repo "$PROJECT_DIR" 2>/dev/null) || VERDICTS=""
fi

# verdict_of <feature>: the CLI's word for it ("ok", a reason id, or "unchecked")
verdict_of() {
    local f reason
    while read -r f reason; do
        if [[ "$f" == "$1" ]]; then echo "$reason"; return; fi
    done <<< "$VERDICTS"
    echo "unchecked"
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
    # A link there (even a dangling one) counts as taken: never follow it (FOLLOWUPS 40)
    if [[ -e "$archive_dir" || -L "$archive_dir" ]]; then
        local counter=1
        while [[ -e "${archive_dir}-${counter}" || -L "${archive_dir}-${counter}" ]]; do
            counter=$((counter + 1))
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
    for feature_name in ${SHIP_CANDIDATES[@]+"${SHIP_CANDIDATES[@]}"}; do
        verdict=$(verdict_of "$feature_name")
        if [[ "$verdict" == ok ]]; then
            echo "  ✅ $feature_name - ship result ok (READY TO ARCHIVE)"
        else
            echo "  🔄 $feature_name - ship result: $verdict"
        fi
    done
    for feature_name in ${NO_RESULT[@]+"${NO_RESULT[@]}"}; do
        echo "  🔄 $feature_name - no phase result"
    done
    exit 0
fi

if [[ ${#NO_RESULT[@]} -gt 0 ]]; then
    echo "no phase result, move by hand: ${NO_RESULT[*]}"
fi

# Archive the features the archive rule passed
archived_count=0
for feature_name in ${SHIP_CANDIDATES[@]+"${SHIP_CANDIDATES[@]}"}; do
    [[ "$(verdict_of "$feature_name")" == ok ]] || continue
    archive_feature "$DEV_ACTIVE/$feature_name" || continue   # refused: not archived, not counted
    archived_count=$((archived_count + 1))
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
