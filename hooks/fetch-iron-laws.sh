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

# Standardized error contract: emit a structured OSSError via the oss-error
# emitter when available (in-band stdout JSON + project workflow.log line).
# Emitter absent or failing → legacy behavior only, never break the hook.
emit_oss_error() {
  local cli=""
  if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" && -f "${CLAUDE_PLUGIN_ROOT}/watcher/dist/cli/oss-error.js" ]]; then
    cli="${CLAUDE_PLUGIN_ROOT}/watcher/dist/cli/oss-error.js"
  else
    # Find latest installed version (version-agnostic); never fail the hook
    cli=$(find "$HOME/.claude/plugins/cache/one-shot-ship-plugin" -name "oss-error.js" -path "*/watcher/dist/cli/*" -type f 2>/dev/null | head -1 || true)
  fi
  [[ -n "$cli" ]] || return 0
  node "$cli" --source "hooks/fetch-iron-laws.sh" "$@" 2>/dev/null || true
}

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
CURL_STATUS=0
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  "${API_URL}${ENDPOINT}") || CURL_STATUS=$?

if [[ "$CURL_STATUS" -ne 0 ]]; then
  echo "Error: Could not reach OSS API (curl exit $CURL_STATUS)" >&2
  emit_oss_error --code OSS-API-003 --severity HIGH \
    --message "IRON LAWS fetch failed: network unreachable (curl exit $CURL_STATUS)" \
    --retry-eligible true --retry-cost cheap
  exit "$CURL_STATUS"
fi

# Extract HTTP status code (last line)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Check for errors
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Error: API returned status $HTTP_CODE" >&2
  case $HTTP_CODE in
    401)
      echo "Authentication failed. Run /oss:login to refresh credentials" >&2
      emit_oss_error --code OSS-AUTH-001 --severity HIGH \
        --message "IRON LAWS fetch failed: authentication rejected (HTTP 401)" \
        --retry-eligible false
      ;;
    403)
      echo "Subscription expired. Upgrade at: https://www.oneshotship.com/pricing" >&2
      emit_oss_error --code OSS-AUTH-002 --severity HIGH \
        --message "IRON LAWS fetch failed: subscription expired (HTTP 403)" \
        --retry-eligible false
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
if [[ "$RAW_OUTPUT" == "true" ]]; then
  echo "$BODY"
else
  # Extract content field if present, otherwise output body
  CONTENT=$(echo "$BODY" | grep -o '"content"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"\([^"]*\)"/\1/' | head -1 || true)
  if [[ -n "$CONTENT" ]]; then
    # Unescape JSON string
    echo -e "$CONTENT"
  else
    echo "$BODY"
  fi
fi
