#!/bin/bash
# fetch-iron-laws.sh - Fetch IRON LAWS from API with authentication
#
# Usage:
#   fetch-iron-laws.sh [--raw]
#
# Options:
#   --raw    Output raw JSON response (default: extract content)
#
# Returns the IRON LAWS content from the API endpoint.
# Uses API key from ~/.oss/config.json

set -euo pipefail

CONFIG_FILE="${HOME}/.oss/config.json"
API_URL="https://one-shot-ship-api.onrender.com"
ENDPOINT="/api/v1/prompts/shared/iron-laws"

# Parse arguments
RAW_OUTPUT=false
for arg in "$@"; do
  case $arg in
    --raw)
      RAW_OUTPUT=true
      shift
      ;;
  esac
done

# Check config file exists
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: Config file not found at $CONFIG_FILE" >&2
  echo "Run /oss:login to configure" >&2
  exit 1
fi

# Extract API key from config
API_KEY=$(grep -o '"apiKey"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" | sed 's/.*: *"\([^"]*\)"/\1/')

if [[ -z "$API_KEY" ]]; then
  echo "Error: No API key found in config" >&2
  echo "Run /oss:login to configure" >&2
  exit 1
fi

# Fetch IRON LAWS with authentication
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  "${API_URL}${ENDPOINT}")

# Extract HTTP status code (last line)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Check for errors
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Error: API returned status $HTTP_CODE" >&2
  case $HTTP_CODE in
    401)
      echo "Authentication failed. Run /oss:login to refresh credentials" >&2
      ;;
    403)
      echo "Subscription expired. Upgrade at: https://www.oneshotship.com/pricing" >&2
      ;;
    404)
      echo "IRON LAWS endpoint not found" >&2
      ;;
    *)
      echo "Response: $BODY" >&2
      ;;
  esac
  exit 1
fi

# Output result
# The API returns plain text (not JSON), so just output the body
echo "$BODY"
