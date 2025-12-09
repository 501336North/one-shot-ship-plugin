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
#   oss-log.sh ironlaw <command> <status> [violations] # Log IRON LAW check result
#   oss-log.sh checklist <command>               # Log IRON LAW completion checklist
#   oss-log.sh health <status> <details_json>    # Log health check results
#   oss-log.sh read <command>                    # Read command log
#   oss-log.sh path <command>                    # Get log file path
#
# Logs are stored in ~/.oss/logs/current-session/
# Format is designed for supervisor watcher pattern detection

set -euo pipefail

LOG_BASE="${HOME}/.oss/logs"
CURRENT_SESSION="${LOG_BASE}/current-session"
UNIFIED_LOG="${CURRENT_SESSION}/session.log"
ARCHIVE_DIR="${LOG_BASE}/archive"

# Configuration (can be overridden via ~/.oss/settings.json)
MAX_SESSION_SIZE_MB=10           # Max size of session.log before rotation
MAX_COMMAND_LOG_SIZE_KB=500      # Max size of individual command logs
MAX_ARCHIVE_COUNT=5              # Keep last N archived sessions
MAX_ARCHIVE_AGE_DAYS=7           # Delete archives older than N days

# Ensure directories exist
mkdir -p "$CURRENT_SESSION"
mkdir -p "$ARCHIVE_DIR"

# Load settings if available
if [[ -f "${HOME}/.oss/settings.json" ]] && command -v jq &>/dev/null; then
    MAX_SESSION_SIZE_MB=$(jq -r '.logs.maxSessionSizeMB // 10' "${HOME}/.oss/settings.json" 2>/dev/null)
    MAX_COMMAND_LOG_SIZE_KB=$(jq -r '.logs.maxCommandLogSizeKB // 500' "${HOME}/.oss/settings.json" 2>/dev/null)
    MAX_ARCHIVE_COUNT=$(jq -r '.logs.maxArchiveCount // 5' "${HOME}/.oss/settings.json" 2>/dev/null)
    MAX_ARCHIVE_AGE_DAYS=$(jq -r '.logs.maxArchiveAgeDays // 7' "${HOME}/.oss/settings.json" 2>/dev/null)
fi

# Helper: Check and rotate session log if too large
check_session_size() {
    if [[ -f "$UNIFIED_LOG" ]]; then
        local size_kb=$(du -k "$UNIFIED_LOG" | cut -f1)
        local max_kb=$((MAX_SESSION_SIZE_MB * 1024))
        if [[ "$size_kb" -gt "$max_kb" ]]; then
            rotate_session_log
        fi
    fi
}

# Helper: Rotate session log
rotate_session_log() {
    local timestamp=$(date '+%Y%m%d-%H%M%S')
    local archive_name="session-${timestamp}.log"
    mv "$UNIFIED_LOG" "${ARCHIVE_DIR}/${archive_name}"
    # Compress the archive
    gzip "${ARCHIVE_DIR}/${archive_name}" 2>/dev/null || true
    # Start fresh
    echo "[$(date '+%H:%M:%S')] [system] [INFO] Session log rotated (previous archived)" > "$UNIFIED_LOG"
}

# Helper: Check and truncate command log if too large
check_command_log_size() {
    local log_file="$1"
    if [[ -f "$log_file" ]]; then
        local size_kb=$(du -k "$log_file" | cut -f1)
        if [[ "$size_kb" -gt "$MAX_COMMAND_LOG_SIZE_KB" ]]; then
            # Keep last 1000 lines, prepend truncation notice
            local temp_file=$(mktemp)
            echo "═══════════════════════════════════════════════════════════════" > "$temp_file"
            echo "  [Log truncated - kept last 1000 lines]" >> "$temp_file"
            echo "═══════════════════════════════════════════════════════════════" >> "$temp_file"
            tail -1000 "$log_file" >> "$temp_file"
            mv "$temp_file" "$log_file"
        fi
    fi
}

# Helper: Clean old archives
clean_old_archives() {
    # Remove archives older than MAX_ARCHIVE_AGE_DAYS
    find "$ARCHIVE_DIR" -name "session-*.log.gz" -mtime +${MAX_ARCHIVE_AGE_DAYS} -delete 2>/dev/null || true

    # Keep only MAX_ARCHIVE_COUNT most recent archives
    local archive_count=$(ls -1 "$ARCHIVE_DIR"/session-*.log.gz 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$archive_count" -gt "$MAX_ARCHIVE_COUNT" ]]; then
        ls -1t "$ARCHIVE_DIR"/session-*.log.gz 2>/dev/null | tail -n +$((MAX_ARCHIVE_COUNT + 1)) | xargs rm -f 2>/dev/null || true
    fi
}

ACTION="${1:-}"
COMMAND="${2:-}"
ARG3="${3:-}"
ARG4="${4:-}"

# Helper to write with consistent format (writes to both command log AND unified session log)
log_entry() {
    local cmd="$1"
    local type="$2"
    local message="$3"
    local timestamp=$(date '+%H:%M:%S')
    local log_file="$CURRENT_SESSION/${cmd}.log"

    # Write to command-specific log
    echo "[$timestamp] [$type] $message" >> "$log_file"

    # Write to unified session log with command prefix
    echo "[$timestamp] [$cmd] [$type] $message" >> "$UNIFIED_LOG"

    # Periodically check sizes (every ~100 writes based on random chance to avoid overhead)
    if [[ $((RANDOM % 100)) -eq 0 ]]; then
        check_session_size
        check_command_log_size "$log_file"
    fi
}

case "$ACTION" in
    init)
        if [[ -z "$COMMAND" ]]; then
            echo "Usage: oss-log.sh init <command>" >&2
            exit 1
        fi
        LOG_FILE="$CURRENT_SESSION/${COMMAND}.log"
        TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

        # Create/clear command log file with header
        {
            echo "═══════════════════════════════════════════════════════════════"
            echo "  OSS Command: /oss:${COMMAND}"
            echo "  Started: $TIMESTAMP"
            echo "  Session: current-session"
            echo "  PID: $$"
            echo "═══════════════════════════════════════════════════════════════"
            echo ""
        } > "$LOG_FILE"

        # Also log to unified session log
        echo "" >> "$UNIFIED_LOG"
        echo "[$(date '+%H:%M:%S')] [$COMMAND] [INIT] ════════ /oss:$COMMAND started ════════" >> "$UNIFIED_LOG"

        echo "$LOG_FILE"
        ;;

    write)
        if [[ -z "$COMMAND" || -z "$ARG3" ]]; then
            echo "Usage: oss-log.sh write <command> <message>" >&2
            exit 1
        fi
        LOG_FILE="$CURRENT_SESSION/${COMMAND}.log"
        TIMESTAMP=$(date '+%H:%M:%S')
        # Append timestamped message to both logs
        echo "[$TIMESTAMP] $ARG3" >> "$LOG_FILE"
        echo "[$TIMESTAMP] [$COMMAND] $ARG3" >> "$UNIFIED_LOG"
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

    ironlaw)
        # Log IRON LAW check results
        # Supervisor uses this to track compliance history
        # Format: [HH:MM:SS] [cmd] [IRON_LAW] PASSED|FAILED violations=[1,4]
        if [[ -z "$COMMAND" || -z "$ARG3" ]]; then
            echo "Usage: oss-log.sh ironlaw <command> <PASSED|FAILED> [violations]" >&2
            exit 1
        fi
        STATUS="$ARG3"
        VIOLATIONS="${ARG4:-}"
        if [[ "$STATUS" == "FAILED" && -n "$VIOLATIONS" ]]; then
            log_entry "$COMMAND" "IRON_LAW" "FAILED violations=[$VIOLATIONS]"
        else
            log_entry "$COMMAND" "IRON_LAW" "$STATUS"
        fi
        ;;

    checklist)
        # Log IRON LAW compliance checklist at command completion
        # This creates a human-readable summary in the logs
        if [[ -z "$COMMAND" ]]; then
            echo "Usage: oss-log.sh checklist <command>" >&2
            exit 1
        fi
        LOG_FILE="$CURRENT_SESSION/${COMMAND}.log"
        TIMESTAMP=$(date '+%H:%M:%S')

        # Gather current state for checklist
        BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
        ON_FEATURE=$([[ "$BRANCH" != "main" && "$BRANCH" != "master" ]] && echo "✓" || echo "✗")

        # Check for skipped tests
        SKIPPED_TESTS="✓"
        if [[ -f "package.json" ]]; then
            if grep -rql "\.skip\|\.todo\|\.only" --include="*.test.ts" --include="*.test.js" --exclude-dir=node_modules 2>/dev/null; then
                SKIPPED_TESTS="✗"
            fi
        fi

        # Check for any types in staged files
        ANY_TYPES="✓"
        if [[ -f "tsconfig.json" ]]; then
            STAGED_TS=$(git diff --cached --name-only 2>/dev/null | grep -E "\.tsx?$" || true)
            if [[ -n "$STAGED_TS" ]]; then
                while IFS= read -r file; do
                    if [[ -n "$file" && -f "$file" ]] && grep -q ": any" "$file" 2>/dev/null; then
                        ANY_TYPES="✗"
                        break
                    fi
                done <<< "$STAGED_TS"
            fi
        fi

        # Check dev docs exist
        DEV_DOCS=$([[ -d "dev/active" ]] && echo "✓" || echo "✗")

        # Write checklist to command log
        {
            echo ""
            echo "[$TIMESTAMP] ═══════════════════════════════════════════════════════"
            echo "[$TIMESTAMP] IRON LAW COMPLIANCE CHECKLIST (/oss:$COMMAND complete)"
            echo "[$TIMESTAMP] ═══════════════════════════════════════════════════════"
            echo "[$TIMESTAMP]   [$ON_FEATURE] LAW #4: On feature branch ($BRANCH)"
            echo "[$TIMESTAMP]   [$SKIPPED_TESTS] LAW #1: No skipped tests (.skip/.todo/.only)"
            echo "[$TIMESTAMP]   [$ANY_TYPES] LAW #2: No 'any' types in staged files"
            echo "[$TIMESTAMP]   [$DEV_DOCS] LAW #6: Dev docs structure exists"
            echo "[$TIMESTAMP]   [?] LAW #3: No loops detected (runtime check)"
            echo "[$TIMESTAMP]   [?] LAW #5: Agent delegation used (manual verification)"
            echo "[$TIMESTAMP] ═══════════════════════════════════════════════════════"
            echo ""
        } >> "$LOG_FILE"

        # Write summary to unified session log
        PASS_COUNT=0
        [[ "$ON_FEATURE" == "✓" ]] && ((PASS_COUNT++))
        [[ "$SKIPPED_TESTS" == "✓" ]] && ((PASS_COUNT++))
        [[ "$ANY_TYPES" == "✓" ]] && ((PASS_COUNT++))
        [[ "$DEV_DOCS" == "✓" ]] && ((PASS_COUNT++))

        echo "[$TIMESTAMP] [$COMMAND] [IRON_LAW] CHECKLIST: ${PASS_COUNT}/4 automated checks passed" >> "$UNIFIED_LOG"
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

    session)
        # Read the unified session log
        if [[ -f "$UNIFIED_LOG" ]]; then
            cat "$UNIFIED_LOG"
        else
            echo "No session log found"
        fi
        ;;

    tail)
        # Follow the unified session log in real-time
        if [[ ! -f "$UNIFIED_LOG" ]]; then
            touch "$UNIFIED_LOG"
        fi
        echo "Following session log (Ctrl+C to stop)..."
        echo "─────────────────────────────────────────"
        tail -f "$UNIFIED_LOG"
        ;;

    session-path)
        # Return path to unified session log
        echo "$UNIFIED_LOG"
        ;;

    # ==========================================================================
    # Log Management Commands
    # ==========================================================================

    status)
        # Show log status and disk usage
        echo "═══════════════════════════════════════════════════════════════"
        echo "  OSS Log Status"
        echo "═══════════════════════════════════════════════════════════════"
        echo ""

        # Current session
        echo "Current Session:"
        if [[ -d "$CURRENT_SESSION" ]]; then
            local session_size=$(du -sh "$CURRENT_SESSION" 2>/dev/null | cut -f1)
            local log_count=$(ls -1 "$CURRENT_SESSION"/*.log 2>/dev/null | wc -l | tr -d ' ')
            echo "  Location: $CURRENT_SESSION"
            echo "  Size: $session_size"
            echo "  Log files: $log_count"
            if [[ -f "$UNIFIED_LOG" ]]; then
                local session_lines=$(wc -l < "$UNIFIED_LOG" | tr -d ' ')
                local session_file_size=$(du -h "$UNIFIED_LOG" | cut -f1)
                echo "  Session log: $session_file_size ($session_lines lines)"
            fi
        else
            echo "  No active session"
        fi
        echo ""

        # Archives
        echo "Archives:"
        if [[ -d "$ARCHIVE_DIR" ]]; then
            local archive_size=$(du -sh "$ARCHIVE_DIR" 2>/dev/null | cut -f1)
            local archive_count=$(ls -1 "$ARCHIVE_DIR"/*.gz 2>/dev/null | wc -l | tr -d ' ')
            echo "  Location: $ARCHIVE_DIR"
            echo "  Size: $archive_size"
            echo "  Archived sessions: $archive_count"
        else
            echo "  No archives"
        fi
        echo ""

        # Total
        local total_size=$(du -sh "$LOG_BASE" 2>/dev/null | cut -f1)
        echo "Total log usage: $total_size"
        echo ""

        # Settings
        echo "Settings:"
        echo "  Max session size: ${MAX_SESSION_SIZE_MB}MB"
        echo "  Max command log: ${MAX_COMMAND_LOG_SIZE_KB}KB"
        echo "  Max archives: $MAX_ARCHIVE_COUNT"
        echo "  Archive retention: ${MAX_ARCHIVE_AGE_DAYS} days"
        ;;

    rotate)
        # Force rotate session log
        if [[ -f "$UNIFIED_LOG" ]]; then
            rotate_session_log
            echo "Session log rotated and archived."
        else
            echo "No session log to rotate."
        fi
        ;;

    clean)
        # Clean old archives and truncate large logs
        echo "Cleaning logs..."

        # Clean old archives
        clean_old_archives
        echo "  ✓ Old archives cleaned"

        # Check and truncate large command logs
        for logfile in "$CURRENT_SESSION"/*.log; do
            if [[ -f "$logfile" && "$(basename "$logfile")" != "session.log" ]]; then
                check_command_log_size "$logfile"
            fi
        done
        echo "  ✓ Large command logs truncated"

        # Check session log
        check_session_size
        echo "  ✓ Session log size checked"

        echo "Done."
        ;;

    purge)
        # Delete all logs (with confirmation)
        if [[ "${ARG3:-}" == "--force" ]]; then
            rm -rf "$CURRENT_SESSION"/*
            rm -rf "$ARCHIVE_DIR"/*
            mkdir -p "$CURRENT_SESSION"
            echo "All logs purged."
        else
            echo "This will delete ALL logs (current session and archives)."
            echo "To confirm, run: oss-log.sh purge --force"
        fi
        ;;

    archives)
        # List archived sessions
        echo "Archived Sessions:"
        if [[ -d "$ARCHIVE_DIR" ]]; then
            ls -lh "$ARCHIVE_DIR"/*.gz 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
            if [[ $? -ne 0 ]]; then
                echo "  No archives found"
            fi
        else
            echo "  No archive directory"
        fi
        ;;

    health)
        # Log health check results
        # Usage: oss-log.sh health <status> <details_json>
        if [[ -z "$COMMAND" || -z "$ARG3" ]]; then
            echo "Usage: oss-log.sh health <status> <details_json>" >&2
            exit 1
        fi
        STATUS="$COMMAND"
        DETAILS_JSON="$ARG3"

        # Log to unified session log with structured format
        TIMESTAMP=$(date '+%H:%M:%S')
        echo "[$TIMESTAMP] [healthcheck] [HEALTH_CHECK] status=$STATUS details=$DETAILS_JSON" >> "$UNIFIED_LOG"
        ;;

    health-check)
        # Run health check in current project (for SwiftBar)
        # Reads current project from ~/.oss/current-project
        # Output written to health-check.log for SwiftBar status detection
        CURRENT_PROJECT=""
        if [[ -f "$HOME/.oss/current-project" ]]; then
            CURRENT_PROJECT=$(cat "$HOME/.oss/current-project" 2>/dev/null)
        fi

        if [[ -z "$CURRENT_PROJECT" || ! -d "$CURRENT_PROJECT" ]]; then
            echo "No active project. Start a Claude Code session first."
            exit 1
        fi

        # Get plugin root for health check CLI
        PLUGIN_ROOT=""
        if [[ -f "$HOME/.oss/plugin-root" ]]; then
            PLUGIN_ROOT=$(cat "$HOME/.oss/plugin-root" 2>/dev/null)
        fi
        HEALTH_CHECK_CLI="$PLUGIN_ROOT/watcher/dist/cli/health-check.js"

        if [[ ! -f "$HEALTH_CHECK_CLI" ]]; then
            echo "Health check CLI not found at: $HEALTH_CHECK_CLI"
            exit 1
        fi

        # Health check log file (SwiftBar reads this to determine status icon)
        HC_LOG="$CURRENT_SESSION/health-check.log"

        echo "Running health check in: $CURRENT_PROJECT"
        echo "─────────────────────────────────────────"

        # Run health check, capture output to both terminal and log file
        cd "$CURRENT_PROJECT" && node "$HEALTH_CHECK_CLI" --verbose 2>&1 | tee "$HC_LOG"
        HC_EXIT="${PIPESTATUS[0]}"

        exit "$HC_EXIT"
        ;;

    *)
        echo "Usage: oss-log.sh <command> [args]" >&2
        echo "" >&2
        echo "Logging Commands:" >&2
        echo "  init <cmd>              Initialize log for command" >&2
        echo "  write <cmd> <msg>       Write to command log" >&2
        echo "  phase <cmd> <phase>     Log TDD phase transition" >&2
        echo "  tool <cmd> <tool>       Log tool call" >&2
        echo "  test <cmd> <status>     Log test result" >&2
        echo "  error <cmd> <error>     Log error" >&2
        echo "  file <cmd> <action>     Log file operation" >&2
        echo "  agent <cmd> <agent>     Log agent delegation" >&2
        echo "  progress <cmd> <n/m>    Log task progress" >&2
        echo "  ironlaw <cmd> <status>  Log IRON LAW check result" >&2
        echo "  checklist <cmd>         Log IRON LAW completion checklist" >&2
        echo "  health <status> <json>  Log health check results" >&2
        echo "" >&2
        echo "Reading Commands:" >&2
        echo "  read <cmd>              Read command log" >&2
        echo "  path <cmd>              Get command log path" >&2
        echo "  session                 Read unified session log" >&2
        echo "  tail                    Follow session log (real-time)" >&2
        echo "  session-path            Get session log path" >&2
        echo "  list                    List all logs" >&2
        echo "" >&2
        echo "Management Commands:" >&2
        echo "  status                  Show log status and disk usage" >&2
        echo "  rotate                  Force rotate session log" >&2
        echo "  clean                   Clean old archives, truncate large logs" >&2
        echo "  purge [--force]         Delete all logs" >&2
        echo "  archives                List archived sessions" >&2
        echo "  clear-session           Archive current and start fresh" >&2
        exit 1
        ;;
esac
