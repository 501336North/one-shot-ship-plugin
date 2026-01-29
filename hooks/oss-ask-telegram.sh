#!/bin/bash
# oss-ask-telegram.sh - Send AskUserQuestion to Telegram
#
# This hook fires BEFORE AskUserQuestion is displayed.
# It sends the question to Telegram so users can see it on their phone.
#
# Input (stdin): JSON with tool_input containing questions array
# Output: None (hook passes through)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS_FILE=~/.oss/settings.json
CONFIG_FILE=~/.oss/config.json

# Read input from stdin
INPUT=$(cat)

# Check if Telegram notifications are enabled
if [[ ! -f "$SETTINGS_FILE" ]]; then
    exit 0
fi

STYLE=$(jq -r '.notifications.style // "visual"' "$SETTINGS_FILE" 2>/dev/null || echo "visual")
if [[ "$STYLE" != "telegram" ]]; then
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

# Send to API (fire and forget - don't block)
{
    curl -s -X POST "$API_URL/api/v1/telegram/question" \
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
        2>/dev/null || true
} &

# Don't wait for curl - let it run in background
# The question will still appear in terminal normally

exit 0
