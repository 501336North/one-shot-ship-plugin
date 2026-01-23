#!/bin/bash
# checkpoint.sh - Build progress tracking with metrics
# Part of OSS Dev Workflow
#
# Commands:
#   create <feature> <name> [--tests-total=N] [--tests-passing=N] [--coverage=N]
#   list <feature>
#   show <feature> <name>
#
# Stores checkpoints in .oss/dev/active/{feature}/checkpoints/
# Keeps only the last 10 checkpoints per feature

set -euo pipefail

# Configuration
MAX_CHECKPOINTS=10
OSS_ROOT="${OSS_DEV_ROOT:-.}"
CHECKPOINTS_BASE="${OSS_ROOT}/.oss/dev/active"

# Parse command
COMMAND="${1:-help}"
FEATURE="${2:-}"
NAME="${3:-}"

# Parse optional arguments
TESTS_TOTAL=""
TESTS_PASSING=""
COVERAGE=""

for arg in "$@"; do
    case $arg in
        --tests-total=*)
            TESTS_TOTAL="${arg#*=}"
            ;;
        --tests-passing=*)
            TESTS_PASSING="${arg#*=}"
            ;;
        --coverage=*)
            COVERAGE="${arg#*=}"
            ;;
    esac
done

# Get checkpoints directory for a feature
get_checkpoints_dir() {
    local feature="$1"
    echo "${CHECKPOINTS_BASE}/${feature}/checkpoints"
}

# Get current git SHA
get_git_sha() {
    git rev-parse HEAD 2>/dev/null || echo "unknown"
}

# Get files changed count
get_files_changed() {
    git status --porcelain 2>/dev/null | wc -l | tr -d ' '
}

# Get ISO timestamp
get_timestamp() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Get filename timestamp
get_filename_timestamp() {
    date +"%Y%m%d-%H%M%S"
}

# Get previous checkpoint
get_previous_checkpoint() {
    local checkpoints_dir="$1"
    if [[ -d "$checkpoints_dir" ]]; then
        ls -t "$checkpoints_dir"/*.json 2>/dev/null | head -1 || echo ""
    else
        echo ""
    fi
}

# Read metric from checkpoint file
read_checkpoint_metric() {
    local file="$1"
    local metric="$2"
    if [[ -f "$file" ]]; then
        if [[ "$metric" == "tests_total" || "$metric" == "tests_passing" || "$metric" == "files_changed" ]]; then
            jq -r ".metrics.${metric} // 0" "$file" 2>/dev/null || echo "0"
        elif [[ "$metric" == "coverage" ]]; then
            jq -r ".metrics.coverage // 0" "$file" 2>/dev/null || echo "0"
        else
            jq -r ".${metric} // \"\"" "$file" 2>/dev/null || echo ""
        fi
    else
        echo "0"
    fi
}

# Calculate and format delta
format_delta() {
    local current="$1"
    local previous="$2"
    local unit="${3:-}"

    local delta=$((current - previous))
    if [[ $delta -gt 0 ]]; then
        echo "+${delta}${unit}"
    elif [[ $delta -lt 0 ]]; then
        echo "${delta}${unit}"
    else
        echo "0${unit}"
    fi
}

# Cleanup old checkpoints, keeping only MAX_CHECKPOINTS
cleanup_old_checkpoints() {
    local checkpoints_dir="$1"
    if [[ -d "$checkpoints_dir" ]]; then
        local count=$(ls -1 "$checkpoints_dir"/*.json 2>/dev/null | wc -l | tr -d ' ')
        if [[ $count -gt $MAX_CHECKPOINTS ]]; then
            local to_delete=$((count - MAX_CHECKPOINTS))
            ls -t "$checkpoints_dir"/*.json | tail -n "$to_delete" | xargs rm -f
        fi
    fi
}

# Count completed tasks from PROGRESS.md if it exists
count_completed_tasks() {
    local feature="$1"
    local progress_file="${CHECKPOINTS_BASE}/${feature}/PROGRESS.md"
    if [[ -f "$progress_file" ]]; then
        grep -c '^\s*-\s*\[x\]' "$progress_file" 2>/dev/null || echo "0"
    else
        echo "0"
    fi
}

# Create command
cmd_create() {
    local feature="$1"
    local name="$2"

    if [[ -z "$feature" || -z "$name" ]]; then
        echo "Usage: checkpoint.sh create <feature> <name>"
        exit 1
    fi

    local checkpoints_dir
    checkpoints_dir=$(get_checkpoints_dir "$feature")
    mkdir -p "$checkpoints_dir"

    # Collect metrics
    local git_sha
    git_sha=$(get_git_sha)

    local files_changed
    files_changed=$(get_files_changed)

    local timestamp
    timestamp=$(get_timestamp)

    local filename_ts
    filename_ts=$(get_filename_timestamp)

    local tasks_completed
    tasks_completed=$(count_completed_tasks "$feature")

    # Use provided values or defaults
    local tests_total_val="${TESTS_TOTAL:-0}"
    local tests_passing_val="${TESTS_PASSING:-0}"
    local coverage_val="${COVERAGE:-0}"

    # Get previous checkpoint for comparison
    local prev_checkpoint
    prev_checkpoint=$(get_previous_checkpoint "$checkpoints_dir")

    # Create checkpoint JSON
    local checkpoint_file="${checkpoints_dir}/${filename_ts}-${name}.json"
    cat > "$checkpoint_file" <<EOF
{
  "name": "${name}",
  "timestamp": "${timestamp}",
  "git_sha": "${git_sha}",
  "metrics": {
    "files_changed": ${files_changed},
    "tests_total": ${tests_total_val},
    "tests_passing": ${tests_passing_val},
    "coverage": ${coverage_val}
  },
  "tasks_completed": ${tasks_completed}
}
EOF

    # Output checkpoint info
    echo "Checkpoint '${name}' created"

    # Show deltas if there's a previous checkpoint
    if [[ -n "$prev_checkpoint" && -f "$prev_checkpoint" ]]; then
        local prev_files prev_tests prev_coverage
        prev_files=$(read_checkpoint_metric "$prev_checkpoint" "files_changed")
        prev_tests=$(read_checkpoint_metric "$prev_checkpoint" "tests_total")
        prev_coverage=$(read_checkpoint_metric "$prev_checkpoint" "coverage")

        local files_delta tests_delta coverage_delta
        files_delta=$(format_delta "$files_changed" "$prev_files")
        tests_delta=$(format_delta "$tests_total_val" "$prev_tests")
        coverage_delta=$(format_delta "$coverage_val" "$prev_coverage" "%")

        echo "  files: ${files_changed} (${files_delta})"
        echo "  tests: ${tests_total_val} (${tests_delta})"
        echo "  coverage: ${coverage_val}% (${coverage_delta})"
    fi

    # Cleanup old checkpoints
    cleanup_old_checkpoints "$checkpoints_dir"
}

# List command
cmd_list() {
    local feature="$1"

    if [[ -z "$feature" ]]; then
        echo "Usage: checkpoint.sh list <feature>"
        exit 1
    fi

    local checkpoints_dir
    checkpoints_dir=$(get_checkpoints_dir "$feature")

    if [[ ! -d "$checkpoints_dir" ]]; then
        echo "No checkpoints found for feature: ${feature}"
        exit 0
    fi

    echo "Checkpoints for '${feature}':"
    echo ""

    for file in "$checkpoints_dir"/*.json; do
        if [[ -f "$file" ]]; then
            local name timestamp
            name=$(jq -r '.name' "$file" 2>/dev/null)
            timestamp=$(jq -r '.timestamp' "$file" 2>/dev/null)
            echo "  - ${name} (${timestamp})"
        fi
    done
}

# Show command
cmd_show() {
    local feature="$1"
    local name="$2"

    if [[ -z "$feature" || -z "$name" ]]; then
        echo "Usage: checkpoint.sh show <feature> <name>"
        exit 1
    fi

    local checkpoints_dir
    checkpoints_dir=$(get_checkpoints_dir "$feature")

    # Find the checkpoint file by name
    local checkpoint_file=""
    for file in "$checkpoints_dir"/*.json; do
        if [[ -f "$file" ]]; then
            local file_name
            file_name=$(jq -r '.name' "$file" 2>/dev/null)
            if [[ "$file_name" == "$name" ]]; then
                checkpoint_file="$file"
                break
            fi
        fi
    done

    if [[ -z "$checkpoint_file" || ! -f "$checkpoint_file" ]]; then
        echo "Checkpoint '${name}' not found for feature: ${feature}"
        exit 1
    fi

    echo "Checkpoint: ${name}"
    echo ""
    jq '.' "$checkpoint_file"
}

# Help command
cmd_help() {
    cat <<EOF
checkpoint.sh - Build progress tracking with metrics

Commands:
  create <feature> <name>   Create a new checkpoint
    Options:
      --tests-total=N       Override tests total count
      --tests-passing=N     Override tests passing count
      --coverage=N          Override coverage percentage

  list <feature>            List all checkpoints for a feature
  show <feature> <name>     Show details of a specific checkpoint

Examples:
  checkpoint.sh create my-feature "after-tdd"
  checkpoint.sh create my-feature "final" --tests-total=50 --tests-passing=50 --coverage=85
  checkpoint.sh list my-feature
  checkpoint.sh show my-feature "after-tdd"
EOF
}

# Main dispatcher
case "$COMMAND" in
    create)
        cmd_create "$FEATURE" "$NAME"
        ;;
    list)
        cmd_list "$FEATURE"
        ;;
    show)
        cmd_show "$FEATURE" "$NAME"
        ;;
    help|--help|-h)
        cmd_help
        ;;
    *)
        echo "Unknown command: ${COMMAND}"
        cmd_help
        exit 1
        ;;
esac
