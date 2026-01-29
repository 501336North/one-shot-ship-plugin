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
SSE_TIMEOUT=300  # 5 minutes

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

    # Check if we have options to match against
    if [[ -f "$OPTIONS_FILE" ]]; then
        # Try to find matching option number
        local option_count=$(jq -r 'length' "$OPTIONS_FILE" 2>/dev/null || echo "0")
        for i in $(seq 0 $((option_count - 1))); do
            local option_label=$(jq -r ".[$i].label // empty" "$OPTIONS_FILE" 2>/dev/null)
            if [[ "$option_label" == "$answer" ]]; then
                # Found matching option, use 1-based index
                terminal_input="$((i + 1))"
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
    fi

    # Use AppleScript to send keystrokes to the frontmost terminal
    # This works for Terminal.app, iTerm2, and other terminal applications
    osascript <<EOF 2>/dev/null
tell application "System Events"
    -- Small delay to ensure terminal is ready
    delay 0.1
    -- Type the answer
    keystroke "$terminal_input"
    -- Press Enter
    keystroke return
end tell
EOF

    return $?
}

# Function to cleanup
cleanup() {
    rm -f "$PENDING_DIR/sse-listener.pid"
}

trap cleanup EXIT

# Connect to SSE endpoint and process events
# Use --no-buffer to get events as they arrive
curl -s --no-buffer \
    -H "Accept: text/event-stream" \
    -H "Cache-Control: no-cache" \
    --max-time $SSE_TIMEOUT \
    "$SSE_URL" 2>/dev/null | while IFS= read -r line; do

    # SSE format: "event: <name>" followed by "data: <json>"
    if [[ "$line" == "event: answer_received"* ]]; then
        # Next line should be the data
        read -r data_line
        if [[ "$data_line" == "data: "* ]]; then
            # Extract JSON data
            JSON_DATA="${data_line#data: }"

            # Parse answer from JSON
            ANSWER=$(echo "$JSON_DATA" | jq -r '.answer // empty' 2>/dev/null)
            ANSWERED_VIA=$(echo "$JSON_DATA" | jq -r '.answeredVia // "telegram"' 2>/dev/null)

            if [[ -n "$ANSWER" ]]; then
                # Write answer to file
                mkdir -p "$PENDING_DIR"
                jq -n \
                    --arg qid "$QUESTION_ID" \
                    --arg answer "$ANSWER" \
                    --arg via "$ANSWERED_VIA" \
                    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
                    '{
                        questionId: $qid,
                        answer: $answer,
                        answeredVia: $via,
                        receivedAt: $ts
                    }' > "$ANSWER_FILE"

                # Inject answer into terminal (if TTY is available)
                if inject_answer_to_terminal "$ANSWER"; then
                    show_notification "✅ $ANSWER (injected to terminal)"
                else
                    show_notification "$ANSWER (answer in terminal manually)"
                fi

                # Exit listener - our job is done
                exit 0
            fi
        fi
    elif [[ "$line" == "event: already_answered"* ]]; then
        # Question was already answered before we connected
        read -r data_line
        if [[ "$data_line" == "data: "* ]]; then
            JSON_DATA="${data_line#data: }"
            ANSWER=$(echo "$JSON_DATA" | jq -r '.answer // empty' 2>/dev/null)

            if [[ -n "$ANSWER" ]]; then
                # Write answer to file
                mkdir -p "$PENDING_DIR"
                jq -n \
                    --arg qid "$QUESTION_ID" \
                    --arg answer "$ANSWER" \
                    --arg via "telegram" \
                    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
                    '{
                        questionId: $qid,
                        answer: $answer,
                        answeredVia: $via,
                        receivedAt: $ts
                    }' > "$ANSWER_FILE"

                # Inject answer into terminal (if TTY is available)
                if inject_answer_to_terminal "$ANSWER"; then
                    show_notification "✅ $ANSWER (already answered, injected)"
                else
                    show_notification "$ANSWER (was already answered)"
                fi
                exit 0
            fi
        fi
    elif [[ "$line" == "event: timeout"* ]]; then
        # SSE connection timed out - that's OK, user probably answered in terminal
        exit 0
    fi
done

# If we get here, the connection was closed or timed out
exit 0
