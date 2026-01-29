#!/bin/bash
# oss-ask-telegram-answered.sh - Report terminal answer to API
#
# This hook fires AFTER AskUserQuestion completes (user answered in terminal).
# It notifies the API so any pending Telegram question can be marked as answered.
#
# Input (stdin): JSON with tool_output containing answers
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

# Extract the answer from tool_output
# The output format contains the user's selected answer(s)
ANSWERS=$(echo "$INPUT" | jq -r '.tool_output.answers // empty' 2>/dev/null)

if [[ -z "$ANSWERS" || "$ANSWERS" == "null" ]]; then
    exit 0
fi

# Get the first answer (most common case)
FIRST_ANSWER=$(echo "$ANSWERS" | jq -r 'to_entries[0].value // empty' 2>/dev/null)

if [[ -z "$FIRST_ANSWER" ]]; then
    exit 0
fi

# Notify API that question was answered via terminal (fire and forget)
{
    curl -s -X POST "$API_URL/api/v1/telegram/answer" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg answer "$FIRST_ANSWER" \
            '{
                answer: $answer,
                answeredVia: "terminal"
            }')" \
        2>/dev/null || true
} &

exit 0
