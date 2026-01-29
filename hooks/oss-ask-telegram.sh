#!/bin/bash
# oss-ask-telegram.sh - Send AskUserQuestion to Telegram with SSE listener
#
# This hook fires BEFORE AskUserQuestion is displayed.
# It sends the question to Telegram AND starts an SSE listener to receive
# answers back from Telegram (bidirectional flow).
#
# Input (stdin): JSON with tool_input containing questions array
# Output: None (hook passes through)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS_FILE=~/.oss/settings.json
CONFIG_FILE=~/.oss/config.json
PENDING_DIR=~/.oss/pending
SSE_PID_FILE="$PENDING_DIR/sse-listener.pid"

# Read input from stdin
INPUT=$(cat)

# Check if Telegram notifications are enabled (independent of notification style)
# This allows users to have visual/audio notifications AND Telegram
if [[ -f "$SETTINGS_FILE" ]]; then
    TELEGRAM_ENABLED=$(jq -r '.telegram.enabled // false' "$SETTINGS_FILE" 2>/dev/null || echo "false")
    if [[ "$TELEGRAM_ENABLED" != "true" ]]; then
        exit 0
    fi
else
    exit 0
fi

# Get API credentials
if [[ ! -f "$CONFIG_FILE" ]]; then
    exit 0
fi

API_KEY=$(jq -r '.apiKey // empty' "$CONFIG_FILE" 2>/dev/null)
API_URL=$(jq -r '.apiUrl // "https://api.oneshotship.com"' "$CONFIG_FILE" 2>/dev/null)

if [[ -z "$API_KEY" ]]; then
    exit 0
fi

# Extract questions from tool_input
# The input format is: { "tool": "AskUserQuestion", "tool_input": { "questions": [...] } }
QUESTIONS=$(echo "$INPUT" | jq -r '.tool_input.questions // empty' 2>/dev/null)

if [[ -z "$QUESTIONS" || "$QUESTIONS" == "null" ]]; then
    exit 0
fi

# Generate a unique question ID
QUESTION_ID="q-$(date +%s)-$$"

# Format the question for Telegram
# Take the first question (most common case)
FIRST_QUESTION=$(echo "$QUESTIONS" | jq -r '.[0].question // empty' 2>/dev/null)
OPTIONS=$(echo "$QUESTIONS" | jq -c '.[0].options // []' 2>/dev/null)
MULTI_SELECT=$(echo "$QUESTIONS" | jq -r '.[0].multiSelect // false' 2>/dev/null)

if [[ -z "$FIRST_QUESTION" ]]; then
    exit 0
fi

# Create pending directory and store questionId for the answered hook
mkdir -p "$PENDING_DIR"
echo "$QUESTION_ID" > "$PENDING_DIR/current-question-id"

# Kill any existing SSE listener from previous question
if [[ -f "$SSE_PID_FILE" ]]; then
    OLD_PID=$(cat "$SSE_PID_FILE" 2>/dev/null || echo "")
    if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
        kill "$OLD_PID" 2>/dev/null || true
    fi
    rm -f "$SSE_PID_FILE"
fi

# Send question to API and start SSE listener in background
{
    # First, send the question
    RESPONSE=$(curl -s -X POST "$API_URL/api/v1/telegram/question" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg qid "$QUESTION_ID" \
            --arg q "$FIRST_QUESTION" \
            --argjson opts "$OPTIONS" \
            --argjson multi "$MULTI_SELECT" \
            '{
                questionId: $qid,
                question: $q,
                options: $opts,
                multiSelect: $multi
            }')" \
        2>/dev/null || echo '{"success":false}')

    # If question was sent successfully, start SSE listener
    if echo "$RESPONSE" | jq -e '.success == true' >/dev/null 2>&1; then
        # Start SSE listener in background to receive Telegram answers
        "$SCRIPT_DIR/sse-telegram-listener.sh" \
            "$API_URL" \
            "$API_KEY" \
            "$QUESTION_ID" \
            &

        # Store SSE listener PID
        echo $! > "$SSE_PID_FILE"
    fi
} &

# Don't wait for background processes - let them run
# The question will still appear in terminal normally

exit 0
