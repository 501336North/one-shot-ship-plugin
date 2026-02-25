#!/bin/bash
# learn-extractor.sh - Extract patterns from session logs after successful ship
#
# Reads .oss/logs/current-session/*.log files and identifies error->resolution patterns.
# Creates pattern files in .oss/skills/learned/{pattern-name}.md
#
# Usage:
#   learn-extractor.sh [--project-root PATH] [--dry-run] [--verbose]
#
# Pattern format:
#   # Pattern: {name}
#
#   **Extracted:** {date}
#   **Source Session:** {session-id}
#
#   ## Problem
#   {what problem was solved}
#
#   ## Solution
#   {how it was solved}
#
#   ## When to Apply
#   {conditions}

set -euo pipefail

# Configuration
PROJECT_ROOT="${OSS_PROJECT_ROOT:-$(pwd)}"
DRY_RUN=false
VERBOSE=false
SESSION_ID=$(date +%Y%m%d-%H%M%S)

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --project-root)
            PROJECT_ROOT="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "Usage: learn-extractor.sh [--project-root PATH] [--dry-run] [--verbose]"
            echo ""
            echo "Extracts patterns from session logs and saves them as learned skills."
            echo ""
            echo "Options:"
            echo "  --project-root PATH  Project root directory (default: current directory)"
            echo "  --dry-run            Show what would be extracted without saving"
            echo "  --verbose            Show detailed output"
            echo "  --help, -h           Show this help message"
            echo ""
            echo "Pattern extraction from session logs:"
            echo "  Reads .oss/logs/current-session/*.log files"
            echo "  Identifies ERROR -> RESOLUTION patterns"
            echo "  Creates .oss/skills/learned/{pattern-name}.md files"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Directories
LOGS_DIR="$PROJECT_ROOT/.oss/logs/current-session"
SKILLS_DIR="$PROJECT_ROOT/.oss/skills/learned"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRITE_LEARNING_SCRIPT="$SCRIPT_DIR/oss-write-learning.sh"

log_verbose() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo "[verbose] $1"
    fi
}

# Create skills directory if it doesn't exist
ensure_dirs() {
    if [[ ! -d "$SKILLS_DIR" ]]; then
        mkdir -p "$SKILLS_DIR"
        log_verbose "Created skills directory: $SKILLS_DIR"
    fi
}

# Find log files
find_log_files() {
    if [[ ! -d "$LOGS_DIR" ]]; then
        echo "No session logs found at: $LOGS_DIR"
        return 1
    fi

    local files
    files=$(find "$LOGS_DIR" -name "*.log" -type f 2>/dev/null || true)

    if [[ -z "$files" ]]; then
        echo "No log files found in: $LOGS_DIR"
        return 1
    fi

    echo "$files"
}

# Extract patterns from a single log file
extract_patterns_from_file() {
    local log_file="$1"
    local patterns=()

    log_verbose "Scanning log file: $log_file"
    echo "Scanning: $(basename "$log_file")"

    # Read file and look for ERROR -> RESOLUTION patterns
    local in_error=false
    local error_lines=""
    local resolution_lines=""

    while IFS= read -r line; do
        # Check for ERROR pattern
        if echo "$line" | grep -qiE '^\[.*\]\s*(ERROR|FAIL|Failed|Exception):'; then
            in_error=true
            error_lines="$line"
            resolution_lines=""
            log_verbose "Found error: $line"
        elif echo "$line" | grep -qiE 'ERROR|FAIL'; then
            if [[ "$in_error" == "true" ]]; then
                error_lines="$error_lines
$line"
            fi
        # Check for RESOLUTION pattern
        elif echo "$line" | grep -qiE '^\[.*\]\s*(RESOLUTION|FIXED|SOLVED|SUCCESS):'; then
            if [[ "$in_error" == "true" ]]; then
                resolution_lines="$line"
                log_verbose "Found resolution: $line"
            fi
        elif echo "$line" | grep -qiE 'RESOLUTION|SUCCESS'; then
            if [[ -n "$error_lines" ]]; then
                resolution_lines="$resolution_lines
$line"
            fi
        fi

        # If we have both error and resolution, extract the pattern
        if [[ -n "$error_lines" && -n "$resolution_lines" ]]; then
            patterns+=("$error_lines|||$resolution_lines")
            echo "  Found pattern: error -> resolution"
            error_lines=""
            resolution_lines=""
            in_error=false
        fi
    done < "$log_file"

    # Return patterns found
    if [[ ${#patterns[@]} -gt 0 ]]; then
        for pattern in "${patterns[@]}"; do
            echo "$pattern"
        done
    fi
}

# Generate pattern name from error text
generate_pattern_name() {
    local error_text="$1"
    local name

    # Extract key terms from the error
    name=$(echo "$error_text" | grep -oiE '(module|dependency|typescript|jest|test|build|compile|import|export|missing|timeout|fail)' | head -1 || echo "generic")

    # Add timestamp for uniqueness
    local timestamp
    timestamp=$(date +%Y%m%d-%H%M%S)

    echo "${name}-${timestamp}"
}

# Create pattern file
create_pattern_file() {
    local error_text="$1"
    local resolution_text="$2"
    local pattern_name

    pattern_name=$(generate_pattern_name "$error_text")
    local pattern_file="$SKILLS_DIR/${pattern_name}.md"

    local extracted_date
    extracted_date=$(date +%Y-%m-%d)

    local content="# Pattern: $pattern_name

**Extracted:** $extracted_date
**Source Session:** $SESSION_ID

## Problem
$error_text

## Solution
$resolution_text

## When to Apply
When encountering similar error patterns in future sessions."

    if [[ "$DRY_RUN" == "true" ]]; then
        echo "[dry-run] Would create: $pattern_file"
        echo "$content"
        echo "---"
    else
        echo "$content" > "$pattern_file"
        echo "Created pattern file: $pattern_file"

        # Also write to LEARNINGS.md for the two-tier learning system
        if [[ -x "$WRITE_LEARNING_SCRIPT" ]]; then
            "$WRITE_LEARNING_SCRIPT" \
                --scope project \
                --category "Pattern" \
                --context "learn-extractor, $pattern_name" \
                --learning "$error_text -> $resolution_text" \
                --project-root "$PROJECT_ROOT" \
                2>/dev/null || true
        fi
    fi
}

# Main execution
main() {
    echo "=== Learn Extractor ==="
    echo "Project: $PROJECT_ROOT"
    echo ""

    ensure_dirs

    # Find log files
    local log_files
    if ! log_files=$(find_log_files); then
        echo "No patterns to extract."
        exit 0
    fi

    echo "Found log files to scan:"
    echo "$log_files" | while read -r file; do
        echo "  - $(basename "$file")"
    done
    echo ""

    local total_patterns=0

    # Process each log file
    echo "$log_files" | while read -r log_file; do
        if [[ -n "$log_file" && -f "$log_file" ]]; then
            # Extract patterns from the file
            local patterns
            patterns=$(extract_patterns_from_file "$log_file" | grep '|||' || true)

            if [[ -n "$patterns" ]]; then
                echo "$patterns" | while IFS='|||' read -r error_text resolution_text; do
                    if [[ -n "$error_text" && -n "$resolution_text" ]]; then
                        create_pattern_file "$error_text" "$resolution_text"
                        ((total_patterns++)) || true
                    fi
                done
            fi
        fi
    done

    echo ""
    echo "=== Extraction Complete ==="
    echo "Patterns extracted: $total_patterns"
    echo "Skills directory: $SKILLS_DIR"
}

main
