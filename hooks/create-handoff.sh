#!/bin/bash
# create-handoff.sh - Agent orchestration handoff document generator
# Part of OSS Dev Workflow
#
# Usage:
#   create-handoff.sh <feature> <from_agent> <to_agent> <summary> [--context="..."] [--questions="..."]
#
# Creates handoff documents in .oss/dev/active/{feature}/handoffs/
# Format: handoff-{from}-to-{to}-{timestamp}.md

set -euo pipefail

# Configuration
OSS_ROOT="${OSS_DEV_ROOT:-.}"
HANDOFFS_BASE="${OSS_ROOT}/.oss/dev/active"

# Parse positional arguments
FEATURE="${1:-}"
FROM_AGENT="${2:-}"
TO_AGENT="${3:-}"
SUMMARY="${4:-}"

# Parse optional arguments
CONTEXT=""
QUESTIONS=""

for arg in "$@"; do
    case $arg in
        --context=*)
            CONTEXT="${arg#*=}"
            ;;
        --questions=*)
            QUESTIONS="${arg#*=}"
            ;;
    esac
done

# Validate required arguments
if [[ -z "$FEATURE" || -z "$FROM_AGENT" || -z "$TO_AGENT" || -z "$SUMMARY" ]]; then
    echo "Usage: create-handoff.sh <feature> <from_agent> <to_agent> <summary> [--context=\"...\"] [--questions=\"...\"]"
    echo ""
    echo "Arguments:"
    echo "  feature     Feature name (directory under .oss/dev/active/)"
    echo "  from_agent  Agent handing off (e.g., backend-architect)"
    echo "  to_agent    Agent receiving handoff (e.g., test-engineer)"
    echo "  summary     Summary of completed task"
    echo ""
    echo "Options:"
    echo "  --context=\"...\"    Additional context for next agent"
    echo "  --questions=\"...\"  Open questions to address"
    exit 1
fi

# Get handoffs directory for a feature
get_handoffs_dir() {
    local feature="$1"
    echo "${HANDOFFS_BASE}/${feature}/handoffs"
}

# Get ISO timestamp
get_timestamp() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Get filename timestamp
get_filename_timestamp() {
    date +"%Y%m%d-%H%M%S"
}

# Get files changed with line counts from git
get_files_modified() {
    # Get list of changed files (staged and unstaged)
    local files_info=""

    # Get staged files with stats
    local staged
    staged=$(git diff --cached --numstat 2>/dev/null || echo "")

    # Get unstaged tracked files with stats
    local unstaged
    unstaged=$(git diff --numstat 2>/dev/null || echo "")

    # Get untracked files - use -uall to show individual files in new directories
    local untracked
    untracked=$(git status --porcelain -uall 2>/dev/null | grep '^??' | sed 's/^?? //' || echo "")

    # Combine all files info
    if [[ -n "$staged" ]]; then
        while IFS=$'\t' read -r added removed file; do
            if [[ -n "$file" ]]; then
                local changes=""
                if [[ "$added" != "-" && "$removed" != "-" ]]; then
                    changes="+${added}/-${removed} lines"
                else
                    changes="binary"
                fi
                files_info="${files_info}| ${file} | ${changes} |"$'\n'
            fi
        done <<< "$staged"
    fi

    if [[ -n "$unstaged" ]]; then
        while IFS=$'\t' read -r added removed file; do
            if [[ -n "$file" ]]; then
                local changes=""
                if [[ "$added" != "-" && "$removed" != "-" ]]; then
                    changes="+${added}/-${removed} lines"
                else
                    changes="binary"
                fi
                files_info="${files_info}| ${file} | ${changes} |"$'\n'
            fi
        done <<< "$unstaged"
    fi

    if [[ -n "$untracked" ]]; then
        while read -r file; do
            if [[ -n "$file" ]]; then
                local line_count
                # Check file relative to git root (current directory when script runs)
                local full_path="${file}"
                if [[ -f "$full_path" ]]; then
                    line_count=$(wc -l < "$full_path" 2>/dev/null | tr -d ' ' || echo "0")
                    files_info="${files_info}| ${file} | +${line_count} lines (new) |"$'\n'
                else
                    # File exists but we can't count lines, just mark as new
                    files_info="${files_info}| ${file} | new file |"$'\n'
                fi
            fi
        done <<< "$untracked"
    fi

    echo "$files_info"
}

# Create the handoff document
create_handoff() {
    local feature="$1"
    local from_agent="$2"
    local to_agent="$3"
    local summary="$4"

    local handoffs_dir
    handoffs_dir=$(get_handoffs_dir "$feature")
    mkdir -p "$handoffs_dir"

    local timestamp
    timestamp=$(get_timestamp)

    local filename_ts
    filename_ts=$(get_filename_timestamp)

    local handoff_file="${handoffs_dir}/handoff-${from_agent}-to-${to_agent}-${filename_ts}.md"

    # Get files modified
    local files_table
    files_table=$(get_files_modified)

    # Build the markdown document
    cat > "$handoff_file" <<EOF
## Handoff: ${from_agent} -> ${to_agent}

**Timestamp:** ${timestamp}
**Feature:** ${feature}

### Task Completed
- ${summary}

### Files Modified
| File | Changes |
|------|---------|
EOF

    # Add files table content
    if [[ -n "$files_table" ]]; then
        echo "$files_table" >> "$handoff_file"
    else
        echo "| (no files modified) | - |" >> "$handoff_file"
    fi

    # Add Context section
    cat >> "$handoff_file" <<EOF

### Context for Next Agent
EOF

    if [[ -n "$CONTEXT" ]]; then
        echo "- ${CONTEXT}" >> "$handoff_file"
    else
        echo "- Key decisions: (none specified)" >> "$handoff_file"
        echo "- Watch out for: (none specified)" >> "$handoff_file"
        echo "- Dependencies: (none specified)" >> "$handoff_file"
    fi

    # Add Open Questions section
    cat >> "$handoff_file" <<EOF

### Open Questions
EOF

    if [[ -n "$QUESTIONS" ]]; then
        echo "- ${QUESTIONS}" >> "$handoff_file"
    else
        echo "- (none specified)" >> "$handoff_file"
    fi

    echo "Handoff document created: ${handoff_file}"
}

# Main
create_handoff "$FEATURE" "$FROM_AGENT" "$TO_AGENT" "$SUMMARY"
