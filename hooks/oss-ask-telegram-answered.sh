#!/bin/bash
# oss-ask-telegram-answered.sh - Report terminal answer to API
#
# This hook fires AFTER AskUserQuestion completes (user answered in terminal).
# It notifies the API so any pending Telegram question can be marked as answered.
#
# First-response-wins: If Telegram already answered, this is a no-op.
#
# Input (stdin): JSON with tool_output containing answers
# Output: None (hook passes through)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS_FILE=~/.oss/settings.json
CONFIG_FILE=~/.oss/config.json
PENDING_DIR=~/.oss/pending
SSE_PID_FILE="$PENDING_DIR/sse-listener.pid"
QUESTION_ID_FILE="$PENDING_DIR/current-question-id"
TELEGRAM_ANSWER_FILE="$PENDING_DIR/telegram-answer.json"

# Function to cleanup pending state
cleanup_pending() {
    # Kill SSE listener if still running
    if [[ -f "$SSE_PID_FILE" ]]; then
        PID=$(cat "$SSE_PID_FILE" 2>/dev/null || echo "")
        if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
            kill "$PID" 2>/dev/null || true
        fi
        rm -f "$SSE_PID_FILE"
    fi
    # Clean up question ID file
    rm -f "$QUESTION_ID_FILE"
    # Clean up telegram answer file
    rm -f "$TELEGRAM_ANSWER_FILE"
}

# Read input from stdin
INPUT=$(cat)

# Check if Telegram notifications are enabled
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
    cleanup_pending
    exit 0
fi

API_KEY=$(jq -r '.apiKey // empty' "$CONFIG_FILE" 2>/dev/null)
API_URL=$(jq -r '.apiUrl // "https://api.oneshotship.com"' "$CONFIG_FILE" 2>/dev/null)

if [[ -z "$API_KEY" ]]; then
    cleanup_pending
    exit 0
fi

# Check if Telegram already answered (first-response-wins)
if [[ -f "$TELEGRAM_ANSWER_FILE" ]]; then
    # Telegram answered first - no need to report terminal answer
    # The API already has the answer from Telegram webhook
    cleanup_pending
    exit 0
fi

# Get the question ID from the PreToolUse hook
if [[ ! -f "$QUESTION_ID_FILE" ]]; then
    cleanup_pending
    exit 0
fi

QUESTION_ID=$(cat "$QUESTION_ID_FILE" 2>/dev/null || echo "")

if [[ -z "$QUESTION_ID" ]]; then
    cleanup_pending
    exit 0
fi

# Extract the answer from tool_output
# The output format contains the user's selected answer(s)
ANSWERS=$(echo "$INPUT" | jq -r '.tool_output.answers // empty' 2>/dev/null)

if [[ -z "$ANSWERS" || "$ANSWERS" == "null" ]]; then
    cleanup_pending
    exit 0
fi

# Get the first answer (most common case)
FIRST_ANSWER=$(echo "$ANSWERS" | jq -r 'to_entries[0].value // empty' 2>/dev/null)

if [[ -z "$FIRST_ANSWER" ]]; then
    cleanup_pending
    exit 0
fi

# Notify API that question was answered via terminal (fire and forget)
# The API uses first-response-wins - if Telegram already answered, this is a no-op
{
    curl -s -X POST "$API_URL/api/v1/telegram/answer" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg qid "$QUESTION_ID" \
            --arg answer "$FIRST_ANSWER" \
            '{
                questionId: $qid,
                answer: $answer
            }')" \
        2>/dev/null || true
} &

# Cleanup pending state
cleanup_pending

exit 0
