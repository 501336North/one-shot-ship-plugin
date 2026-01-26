#!/bin/bash
# OSS Log Analyzer Hook
# Extracts metrics from local session logs at command completion
#
# Trigger: Called at the end of oss:ideate, oss:plan, oss:build, oss:ship
# Input: $1 = command name (ideate, plan, build, ship)
# Output: JSON to stdout with extracted metrics
#
# Usage: oss-log-analyzer.sh <command>
# Example: oss-log-analyzer.sh build

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# =============================================================================
# Configuration
# =============================================================================
SESSION_LOG="${HOME}/.oss/logs/current-session/session.log"
PRECHECK_LOG="${HOME}/.oss/logs/current-session/precheck.log"

# Command name from argument
COMMAND="${1:-unknown}"

# =============================================================================
# Helper: Escape string for JSON
# =============================================================================
json_escape() {
    local str="$1"
    # Trim leading/trailing whitespace
    str="${str#"${str%%[![:space:]]*}"}"  # trim leading
    str="${str%"${str##*[![:space:]]}"}"  # trim trailing
    # Escape backslashes, double quotes, and control characters
    str=$(printf '%s' "$str" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g')
    # Replace newlines with space
    str=$(printf '%s' "$str" | tr '\n' ' ')
    printf '%s' "$str"
}

# =============================================================================
# Helper: Output null or value for JSON
# =============================================================================
json_value() {
    local val="$1"
    # Trim whitespace first
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    if [[ -z "$val" || "$val" == "null" ]]; then
        printf 'null'
    elif [[ "$val" =~ ^[0-9]+$ ]]; then
        printf '%s' "$val"
    else
        printf '"%s"' "$(json_escape "$val")"
    fi
}

# =============================================================================
# Extract Git Info
# =============================================================================
get_git_info() {
    local project branch

    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        project=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
        branch=$(git branch --show-current 2>/dev/null || echo "")
    else
        project=""
        branch=""
    fi

    echo "$project|$branch"
}

# =============================================================================
# Calculate Duration from Session Log
# =============================================================================
calculate_duration() {
    local start_time end_time duration_seconds

    if [[ ! -f "$SESSION_LOG" ]]; then
        echo "null"
        return
    fi

    # Look for command-specific log file first (more reliable)
    local cmd_log="${HOME}/.oss/logs/current-session/${COMMAND}.log"

    if [[ -f "$cmd_log" ]]; then
        # Extract from command log header: "Started: YYYY-MM-DD HH:MM:SS"
        local start_datetime
        start_datetime=$(grep -oE 'Started: [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}' "$cmd_log" 2>/dev/null | head -1 | grep -oE '[0-9]{2}:[0-9]{2}:[0-9]{2}' || echo "")
        if [[ -n "$start_datetime" ]]; then
            start_time="$start_datetime"
        fi
    fi

    # Fall back to session log patterns
    if [[ -z "$start_time" ]]; then
        # Look for command-specific [INIT] marker
        start_time=$(grep -E "^\[[0-9]{2}:[0-9]{2}:[0-9]{2}\] \[$COMMAND\] \[INIT\]" "$SESSION_LOG" 2>/dev/null | tail -1 | grep -oE '\[[0-9]{2}:[0-9]{2}:[0-9]{2}\]' | head -1 | tr -d '[]' || echo "")
    fi

    # If no command-specific start, fall back to most recent session start (within last hour)
    if [[ -z "$start_time" ]]; then
        start_time=$(grep -E "^\[[0-9]{2}:[0-9]{2}:[0-9]{2}\] \[session\] \[START\]" "$SESSION_LOG" 2>/dev/null | tail -1 | grep -oE '\[[0-9]{2}:[0-9]{2}:[0-9]{2}\]' | head -1 | tr -d '[]' || echo "")
    fi

    # Get end time: use current time (command is completing now)
    end_time=$(date '+%H:%M:%S')

    if [[ -z "$start_time" ]]; then
        echo "null"
        return
    fi

    # Convert HH:MM:SS to seconds
    local start_secs end_secs h m s
    IFS=':' read -r h m s <<< "$start_time"
    start_secs=$((10#$h * 3600 + 10#$m * 60 + 10#$s))

    IFS=':' read -r h m s <<< "$end_time"
    end_secs=$((10#$h * 3600 + 10#$m * 60 + 10#$s))

    # Handle day rollover (e.g., start at 23:50, end at 00:10)
    if [[ $end_secs -lt $start_secs ]]; then
        end_secs=$((end_secs + 86400))
    fi

    duration_seconds=$((end_secs - start_secs))
    echo "$duration_seconds"
}

# =============================================================================
# Count Tests from Session Log (for /oss:build)
# =============================================================================
count_tests() {
    local tests_written=0
    local tests_passed=0
    local tests_failed=0

    if [[ ! -f "$SESSION_LOG" ]]; then
        echo "0|0|0"
        return
    fi

    # Look for command-specific log file first
    local cmd_log="${HOME}/.oss/logs/current-session/${COMMAND}.log"
    local log_to_check="$SESSION_LOG"
    if [[ -f "$cmd_log" ]]; then
        log_to_check="$cmd_log"
    fi

    # Count [TEST] log entries (from oss-log.sh test action)
    local passed_count failed_count
    passed_count=$(grep -cE '^\[[0-9]{2}:[0-9]{2}:[0-9]{2}\] \[TEST\].*PASS' "$log_to_check" 2>/dev/null) || passed_count=0
    failed_count=$(grep -cE '^\[[0-9]{2}:[0-9]{2}:[0-9]{2}\] \[TEST\].*FAIL' "$log_to_check" 2>/dev/null) || failed_count=0

    # Ensure values are integers
    tests_passed=$((passed_count + 0))
    tests_failed=$((failed_count + 0))

    # If no [TEST] entries, try to extract from vitest/jest summary output
    # Pattern: "Tests  42 passed (128)" or "Tests: 42 passed, 3 failed"
    if [[ "$tests_passed" -eq 0 && "$tests_failed" -eq 0 ]]; then
        local test_summary
        # Vitest pattern: "Tests  42 passed"
        test_summary=$(grep -oE 'Tests[[:space:]]+[0-9]+ passed' "$log_to_check" 2>/dev/null | tail -1 | grep -oE '[0-9]+' | head -1) || test_summary=""
        if [[ -n "$test_summary" && "$test_summary" =~ ^[0-9]+$ ]]; then
            tests_passed=$((test_summary + 0))
        fi

        # Jest/vitest pattern: "X failed"
        test_summary=$(grep -oE '[0-9]+ failed' "$log_to_check" 2>/dev/null | tail -1 | grep -oE '[0-9]+' | head -1) || test_summary=""
        if [[ -n "$test_summary" && "$test_summary" =~ ^[0-9]+$ ]]; then
            tests_failed=$((test_summary + 0))
        fi
    fi

    # Calculate total
    tests_written=$((tests_passed + tests_failed))

    echo "$tests_written|$tests_passed|$tests_failed"
}

# =============================================================================
# Count Files Changed
# =============================================================================
count_files_changed() {
    local files_changed=0

    # Count files changed in last commit (if there was one during the session)
    local count
    count=$(git diff --name-only HEAD~1 2>/dev/null | wc -l | tr -d ' \n\t') || count="0"

    # Ensure it's a number
    if [[ "$count" =~ ^[0-9]+$ ]]; then
        files_changed=$((count + 0))
    fi

    # If no recent commit, count currently modified/staged files
    if [[ "$files_changed" -eq 0 ]]; then
        count=$(git status --short 2>/dev/null | wc -l | tr -d ' \n\t') || count="0"
        if [[ "$count" =~ ^[0-9]+$ ]]; then
            files_changed=$((count + 0))
        fi
    fi

    echo "$files_changed"
}

# =============================================================================
# Extract Code Coverage
# =============================================================================
get_coverage() {
    local coverage

    if [[ ! -f "$SESSION_LOG" ]]; then
        echo "null"
        return
    fi

    # Look for coverage percentage in various formats
    # - "Coverage: XX%"
    # - "All files | XX.XX |"
    # - "XX% Statements"
    coverage=$(grep -oE '[Cc]overage[:\s]+[0-9]+(\.[0-9]+)?%|[0-9]+(\.[0-9]+)?%\s+[Ss]tatements|All files\s*\|\s*[0-9]+(\.[0-9]+)?' "$SESSION_LOG" 2>/dev/null | tail -1 | grep -oE '[0-9]+(\.[0-9]+)?' | head -1 || echo "")

    if [[ -z "$coverage" ]]; then
        echo "null"
    else
        echo "$coverage"
    fi
}

# =============================================================================
# Extract Iron Law Violations
# =============================================================================
get_violations() {
    local violations=()

    # Check both precheck.log and session.log for violations
    local log_files=("$SESSION_LOG")
    if [[ -f "$PRECHECK_LOG" ]]; then
        log_files+=("$PRECHECK_LOG")
    fi

    for log_file in "${log_files[@]}"; do
        if [[ -f "$log_file" ]]; then
            # Extract violation law numbers from patterns like:
            # - "IRON_LAW] FAILED violations=[1,4,6]"
            # - "LAW #4 VIOLATION"
            # - "LAW #1: Found skipped/focused tests"
            while IFS= read -r line; do
                if [[ "$line" =~ violations=\[([0-9,]+)\] ]]; then
                    IFS=',' read -ra nums <<< "${BASH_REMATCH[1]}"
                    for num in "${nums[@]}"; do
                        [[ -n "$num" ]] && violations+=("$num")
                    done
                elif [[ "$line" =~ LAW[[:space:]]*#([0-9]+)[[:space:]]*(VIOLATION|:.*) ]]; then
                    violations+=("${BASH_REMATCH[1]}")
                fi
            done < <(grep -E 'VIOLATION|FAILED' "$log_file" 2>/dev/null || true)
        fi
    done

    # Remove duplicates and format as JSON array
    if [[ ${#violations[@]} -eq 0 ]]; then
        echo "[]"
    else
        # Unique values only
        local unique_violations
        unique_violations=$(printf '%s\n' "${violations[@]}" | sort -u | tr '\n' ',' | sed 's/,$//')
        echo "[${unique_violations}]"
    fi
}

# =============================================================================
# Count Checks
# =============================================================================
count_checks() {
    local checks_passed checks_total

    # Default: 6 total checks (LAW #1-6)
    checks_total=6
    checks_passed=6

    if [[ -f "$SESSION_LOG" ]]; then
        # Look for checklist output: "CHECKLIST: X/Y automated checks passed"
        local checklist_line
        checklist_line=$(grep -oE 'CHECKLIST: [0-9]+/[0-9]+' "$SESSION_LOG" 2>/dev/null | tail -1 || echo "")
        if [[ -n "$checklist_line" ]]; then
            checks_passed=$(echo "$checklist_line" | grep -oE '[0-9]+' | head -1)
            checks_total=$(echo "$checklist_line" | grep -oE '[0-9]+' | tail -1)
        fi
    fi

    # If violations were found, decrement passed count
    local violations_json
    violations_json=$(get_violations)
    if [[ "$violations_json" != "[]" ]]; then
        local violation_count
        violation_count=$(echo "$violations_json" | tr -cd ',' | wc -c | tr -d ' ')
        violation_count=$((violation_count + 1))  # commas + 1 = count
        checks_passed=$((checks_total - violation_count))
        [[ $checks_passed -lt 0 ]] && checks_passed=0
    fi

    echo "$checks_passed|$checks_total"
}

# =============================================================================
# Main: Build JSON Output
# =============================================================================
main() {
    # Extract all metrics
    local git_info duration tests coverage files_changed violations checks

    git_info=$(get_git_info)
    local project branch
    IFS='|' read -r project branch <<< "$git_info"

    duration=$(calculate_duration)

    tests=$(count_tests)
    local tests_written tests_passed tests_failed
    IFS='|' read -r tests_written tests_passed tests_failed <<< "$tests"

    coverage=$(get_coverage)
    files_changed=$(count_files_changed)
    violations=$(get_violations)

    checks=$(count_checks)
    local checks_passed checks_total
    IFS='|' read -r checks_passed checks_total <<< "$checks"

    # Build JSON output
    cat << EOF
{
  "command": $(json_value "$COMMAND"),
  "durationSeconds": $duration,
  "project": $(json_value "$project"),
  "branch": $(json_value "$branch"),
  "testsWritten": $tests_written,
  "testsPassed": $tests_passed,
  "testsFailed": $tests_failed,
  "filesChanged": $files_changed,
  "codeCoveragePercent": $coverage,
  "ironLawViolations": $violations,
  "checksTotal": $checks_total,
  "checksPassed": $checks_passed
}
EOF
}

# =============================================================================
# Entry Point
# =============================================================================

# Validate command argument
if [[ -z "$COMMAND" || "$COMMAND" == "unknown" ]]; then
    echo '{"error": "Command argument required", "usage": "oss-log-analyzer.sh <command>"}' >&2
    exit 1
fi

# Log hook start (optional, for supervisor visibility)
LOG_SCRIPT="$SCRIPT_DIR/oss-log.sh"
if [[ -x "$LOG_SCRIPT" ]]; then
    "$LOG_SCRIPT" hook oss-log-analyzer START "$COMMAND" 2>/dev/null || true
fi

# Run main and output JSON
main

# Log hook complete
if [[ -x "$LOG_SCRIPT" ]]; then
    "$LOG_SCRIPT" hook oss-log-analyzer COMPLETE "$COMMAND" 2>/dev/null || true
fi

exit 0
