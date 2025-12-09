#!/bin/bash
# oss-log.sh - Workflow logging for OSS commands
#
# Usage:
#   oss-log.sh init <command>                    # Initialize log for command
#   oss-log.sh write <command> <message>         # Append to command log
#   oss-log.sh phase <command> <phase> [status]  # Log TDD phase transition
#   oss-log.sh tool <command> <tool> [result]    # Log tool call
#   oss-log.sh test <command> <status> [details] # Log test execution
#   oss-log.sh error <command> <error>           # Log error/exception
#   oss-log.sh file <command> <action> <path>    # Log file operation
#   oss-log.sh agent <command> <agent> [task]    # Log agent delegation
#   oss-log.sh read <command>                    # Read command log
#   oss-log.sh path <command>                    # Get log file path
#
# Logs are stored in ~/.oss/logs/current-session/
# Format is designed for supervisor watcher pattern detection

set -euo pipefail

LOG_BASE="${HOME}/.oss/logs"
CURRENT_SESSION="${LOG_BASE}/current-session"

# Ensure directories exist
mkdir -p "$CURRENT_SESSION"

ACTION="${1:-}"
COMMAND="${2:-}"
ARG3="${3:-}"
ARG4="${4:-}"

# Helper to write with consistent format
log_entry() {
    local cmd="$1"
    local type="$2"
    local message="$3"
    local log_file="$CURRENT_SESSION/${cmd}.log"
    echo "[$(date '+%H:%M:%S')] [$type] $message" >> "$log_file"
}

case "$ACTION" in
    init)
        if [[ -z "$COMMAND" ]]; then
            echo "Usage: oss-log.sh init <command>" >&2
            exit 1
        fi
        LOG_FILE="$CURRENT_SESSION/${COMMAND}.log"
        # Create/clear log file with header
        {
            echo "═══════════════════════════════════════════════════════════════"
            echo "  OSS Command: /oss:${COMMAND}"
            echo "  Started: $(date '+%Y-%m-%d %H:%M:%S')"
            echo "  Session: current-session"
            echo "  PID: $$"
            echo "═══════════════════════════════════════════════════════════════"
            echo ""
        } > "$LOG_FILE"
        echo "$LOG_FILE"
        ;;

    write)
        if [[ -z "$COMMAND" || -z "$ARG3" ]]; then
            echo "Usage: oss-log.sh write <command> <message>" >&2
            exit 1
        fi
        LOG_FILE="$CURRENT_SESSION/${COMMAND}.log"
        # Append timestamped message
        echo "[$(date '+%H:%M:%S')] $ARG3" >> "$LOG_FILE"
        ;;

    phase)
        # Log TDD phase transitions: RED, GREEN, REFACTOR
        # Watcher uses this to detect stuck phases and TDD violations
        if [[ -z "$COMMAND" || -z "$ARG3" ]]; then
            echo "Usage: oss-log.sh phase <command> <phase> [status]" >&2
            exit 1
        fi
        PHASE="$ARG3"
        STATUS="${ARG4:-start}"
        log_entry "$COMMAND" "PHASE" "$PHASE $STATUS"
        ;;

    tool)
        # Log tool calls: Read, Write, Edit, Bash, Grep, etc.
        # Watcher uses repeat_count to detect loops
        if [[ -z "$COMMAND" || -z "$ARG3" ]]; then
            echo "Usage: oss-log.sh tool <command> <tool> [result]" >&2
            exit 1
        fi
        TOOL="$ARG3"
        RESULT="${ARG4:-called}"
        log_entry "$COMMAND" "TOOL" "$TOOL: $RESULT"
        ;;

    test)
        # Log test execution results
        # Watcher uses this to detect test_failure, test_flaky, coverage_drop
        if [[ -z "$COMMAND" || -z "$ARG3" ]]; then
            echo "Usage: oss-log.sh test <command> <status> [details]" >&2
            exit 1
        fi
        STATUS="$ARG3"
        DETAILS="${ARG4:-}"
        if [[ -n "$DETAILS" ]]; then
            log_entry "$COMMAND" "TEST" "$STATUS - $DETAILS"
        else
            log_entry "$COMMAND" "TEST" "$STATUS"
        fi
        ;;

    error)
        # Log errors and exceptions
        # Watcher uses this to detect agent_error, exception
        if [[ -z "$COMMAND" || -z "$ARG3" ]]; then
            echo "Usage: oss-log.sh error <command> <error>" >&2
            exit 1
        fi
        ERROR="$ARG3"
        log_entry "$COMMAND" "ERROR" "$ERROR"
        ;;

    file)
        # Log file operations: create, modify, delete
        if [[ -z "$COMMAND" || -z "$ARG3" ]]; then
            echo "Usage: oss-log.sh file <command> <action> <path>" >&2
            exit 1
        fi
        FILE_ACTION="$ARG3"
        FILE_PATH="${ARG4:-}"
        log_entry "$COMMAND" "FILE" "$FILE_ACTION $FILE_PATH"
        ;;

    agent)
        # Log agent delegations
        # Watcher uses this to track agent spawning and potential loops
        if [[ -z "$COMMAND" || -z "$ARG3" ]]; then
            echo "Usage: oss-log.sh agent <command> <agent> [task]" >&2
            exit 1
        fi
        AGENT="$ARG3"
        TASK="${ARG4:-spawned}"
        log_entry "$COMMAND" "AGENT" "$AGENT: $TASK"
        ;;

    progress)
        # Log task progress for build command
        if [[ -z "$COMMAND" || -z "$ARG3" ]]; then
            echo "Usage: oss-log.sh progress <command> <current/total> [task_name]" >&2
            exit 1
        fi
        PROGRESS="$ARG3"
        TASK_NAME="${ARG4:-}"
        if [[ -n "$TASK_NAME" ]]; then
            log_entry "$COMMAND" "PROGRESS" "$PROGRESS - $TASK_NAME"
        else
            log_entry "$COMMAND" "PROGRESS" "$PROGRESS"
        fi
        ;;

    read)
        if [[ -z "$COMMAND" ]]; then
            echo "Usage: oss-log.sh read <command>" >&2
            exit 1
        fi
        LOG_FILE="$CURRENT_SESSION/${COMMAND}.log"
        if [[ -f "$LOG_FILE" ]]; then
            cat "$LOG_FILE"
        else
            echo "No log found for /oss:${COMMAND}"
        fi
        ;;

    path)
        if [[ -z "$COMMAND" ]]; then
            echo "Usage: oss-log.sh path <command>" >&2
            exit 1
        fi
        echo "$CURRENT_SESSION/${COMMAND}.log"
        ;;

    clear-session)
        # Archive current session and start fresh
        if [[ -d "$CURRENT_SESSION" ]]; then
            ARCHIVE_NAME="session-$(date '+%Y%m%d-%H%M%S')"
            mv "$CURRENT_SESSION" "${LOG_BASE}/${ARCHIVE_NAME}"
        fi
        mkdir -p "$CURRENT_SESSION"
        echo "Session archived. Started fresh session."
        ;;

    list)
        # List all logs in current session
        if [[ -d "$CURRENT_SESSION" ]]; then
            ls -la "$CURRENT_SESSION"/*.log 2>/dev/null || echo "No logs in current session"
        else
            echo "No current session"
        fi
        ;;

    *)
        echo "Usage: oss-log.sh <init|write|read|path|clear-session|list> [args]" >&2
        exit 1
        ;;
esac
