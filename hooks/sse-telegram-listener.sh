#!/bin/bash
# sse-telegram-listener.sh - Listen for Telegram answers via SSE
#
# This script runs in the background and listens for SSE events from the API.
# When a Telegram answer is received, it:
# 1. Writes the answer to ~/.oss/pending/telegram-answer.json
# 2. Shows a macOS notification
# 3. Injects the answer into the terminal (if TTY is available)
# 4. Exits
#
# Arguments:
#   $1 - API_URL (e.g., https://api.oneshotship.com)
#   $2 - API_KEY
#   $3 - QUESTION_ID

set -euo pipefail

API_URL="$1"
API_KEY="$2"
QUESTION_ID="$3"

PENDING_DIR=~/.oss/pending
ANSWER_FILE="$PENDING_DIR/telegram-answer.json"
TTY_FILE="$PENDING_DIR/terminal-tty"
OPTIONS_FILE="$PENDING_DIR/question-options.json"
TERMINAL_APP_FILE="$PENDING_DIR/terminal-app"
LOG_DIR=~/.oss/logs
LOG_FILE="$LOG_DIR/sse-listener.log"
SSE_TIMEOUT=300  # 5 minutes

# Ensure directories exist
mkdir -p "$PENDING_DIR" "$LOG_DIR"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [sse-listener] [$QUESTION_ID] $*" >> "$LOG_FILE"
}

log "Starting SSE listener"
log "API URL: $API_URL"

# SSE endpoint URL
SSE_URL="$API_URL/api/v1/telegram/subscribe/$QUESTION_ID?token=$API_KEY"

# Function to show macOS notification
show_notification() {
    local answer="$1"
    # Escape the answer for AppleScript
    local escaped_answer=$(echo "$answer" | sed 's/"/\\"/g' | head -c 100)
    osascript -e "display notification \"$escaped_answer\" with title \"Telegram Answer\" subtitle \"Answered via Telegram\"" 2>/dev/null || true
}

# Function to inject answer into terminal using AppleScript
inject_answer_to_terminal() {
    local answer="$1"
    local terminal_input=""

    log "Attempting to inject answer to terminal: $answer"

    # Check if we have options to match against
    if [[ -f "$OPTIONS_FILE" ]]; then
        # Try to find matching option number
        local option_count=$(jq -r 'length' "$OPTIONS_FILE" 2>/dev/null || echo "0")
        for i in $(seq 0 $((option_count - 1))); do
            local option_label=$(jq -r ".[$i].label // empty" "$OPTIONS_FILE" 2>/dev/null)
            if [[ "$option_label" == "$answer" ]]; then
                # Found matching option, use 1-based index
                terminal_input="$((i + 1))"
                log "Matched option $((i + 1)): $option_label"
                break
            fi
        done
    fi

    # If no matching option found, it's a custom "Other" response
    # We need to type the last option + 1 (for "Other"), then the custom text
    if [[ -z "$terminal_input" ]]; then
        local option_count=$(jq -r 'length' "$OPTIONS_FILE" 2>/dev/null || echo "0")
        # "Other" is typically option count + 1
        # We'll just send the answer text and hope Claude handles it
        terminal_input="$answer"
        log "No matching option found, using raw answer"
    fi

    # Escape special characters for AppleScript
    local escaped_input=$(echo "$terminal_input" | sed 's/\\/\\\\/g; s/"/\\"/g')

    # Get the terminal app name (saved by oss-ask-telegram.sh)
    local terminal_app="Terminal"
    if [[ -f "$TERMINAL_APP_FILE" ]]; then
        terminal_app=$(cat "$TERMINAL_APP_FILE" 2>/dev/null || echo "Terminal")
    fi

    # Map TERM_PROGRAM values to actual app names for AppleScript
    case "$terminal_app" in
        "WarpTerminal") terminal_app="Warp" ;;
        "iTerm.app") terminal_app="iTerm" ;;
        "Apple_Terminal") terminal_app="Terminal" ;;
        "vscode") terminal_app="Visual Studio Code" ;;
        *) ;; # Use as-is for others
    esac

    log "Activating terminal app: $terminal_app"

    # Save current clipboard content
    local old_clipboard=$(pbpaste 2>/dev/null || echo "")

    # Copy answer to clipboard (without newline - we'll send Enter separately)
    echo -n "$terminal_input" | pbcopy

    # Use AppleScript to paste then press Enter
    local applescript_result
    applescript_result=$(osascript <<EOF 2>&1
tell application "$terminal_app"
    activate
end tell
-- Wait for app to fully come to foreground (important when switching from other apps)
delay 1.0
tell application "System Events"
    -- Paste from clipboard
    keystroke "v" using command down
    delay 0.3
    -- Press Enter using key code (36 = Return key)
    key code 36
end tell
EOF
)

    # Restore old clipboard after a delay (don't block)
    (sleep 2 && echo -n "$old_clipboard" | pbcopy) &
    local exit_code=$?

    if [[ $exit_code -eq 0 ]]; then
        log "Successfully injected answer to terminal"
        return 0
    else
        log "Failed to inject answer to terminal (exit=$exit_code): $applescript_result"
        return 1
    fi
}

# Function to process an answer (common logic for answer_received and already_answered)
process_answer() {
    local json_data="$1"
    local event_type="$2"

    # Parse answer from JSON
    local answer=$(echo "$json_data" | jq -r '.answer // empty' 2>/dev/null)
    local answered_via=$(echo "$json_data" | jq -r '.answeredVia // "telegram"' 2>/dev/null)

    if [[ -n "$answer" ]]; then
        log "Received answer ($event_type): $answer (via $answered_via)"

        # Write answer to file
        jq -n \
            --arg qid "$QUESTION_ID" \
            --arg answer "$answer" \
            --arg via "$answered_via" \
            --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            '{
                questionId: $qid,
                answer: $answer,
                answeredVia: $via,
                receivedAt: $ts
            }' > "$ANSWER_FILE"

        log "Wrote answer to $ANSWER_FILE"

        # Inject answer into terminal (if TTY is available)
        if inject_answer_to_terminal "$answer"; then
            show_notification "✅ $answer (injected to terminal)"
        else
            show_notification "$answer (answer in terminal manually)"
        fi

        return 0
    else
        log "No answer in JSON data"
        return 1
    fi
}

# Function to cleanup
cleanup() {
    log "Cleaning up SSE listener"
    rm -f "$PENDING_DIR/sse-listener.pid"
}

trap cleanup EXIT

log "Connecting to SSE endpoint: $SSE_URL"

# Connect to SSE endpoint and process events
# Use --no-buffer to get events as they arrive
# Store current event type as we parse lines
CURRENT_EVENT=""

curl -s --no-buffer \
    -H "Accept: text/event-stream" \
    -H "Cache-Control: no-cache" \
    --max-time $SSE_TIMEOUT \
    "$SSE_URL" 2>/dev/null | while IFS= read -r line; do

    # Remove carriage returns (SSE uses \r\n)
    line="${line%$'\r'}"

    # Skip empty lines (SSE event delimiter)
    if [[ -z "$line" ]]; then
        CURRENT_EVENT=""
        continue
    fi

    # Handle SSE comments (heartbeats)
    if [[ "$line" == ":"* ]]; then
        log "Received heartbeat"
        continue
    fi

    # Parse event type
    if [[ "$line" == "event: "* ]]; then
        CURRENT_EVENT="${line#event: }"
        log "Received event: $CURRENT_EVENT"
        continue
    fi

    # Parse data
    if [[ "$line" == "data: "* ]]; then
        JSON_DATA="${line#data: }"

        case "$CURRENT_EVENT" in
            "connected")
                log "Connected to SSE endpoint successfully"
                ;;
            "answer_received"|"already_answered")
                if process_answer "$JSON_DATA" "$CURRENT_EVENT"; then
                    log "Answer processed successfully, exiting"
                    exit 0
                fi
                ;;
            "timeout")
                log "SSE connection timed out from server"
                exit 0
                ;;
            *)
                log "Unknown event type: $CURRENT_EVENT"
                ;;
        esac
    fi
done

# If we get here, the connection was closed or timed out
log "SSE connection closed, exiting"
exit 0
