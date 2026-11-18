#!/bin/bash
# fetch-iron-laws.sh - Fetch IRON LAWS from API with authentication
#
# Usage:
#   fetch-iron-laws.sh [--raw]
#
# Options:
#   --raw    Output the verified ?split=1 JSON reply (default: the laws, base + team)
#
# Returns the IRON LAWS content from the API endpoint: GET .../shared/iron-laws?split=1 answers {base, team?}.
# The raw base bytes must pass `~/.oss/bin/oss-decrypt --verify-body shared/iron-laws` (R-273 D12); only its
# exit 0 prints anything. A reply that is not that JSON is refused (exit 1), never retried unsplit. Team laws are
# printed as served, under the server's advisory note (unverified, DR-3).
# Uses apiKey and apiUrl from the OSS config ($OSS_CONFIG_DIR/config.json, else ~/.oss/config.json)

set -euo pipefail
if [[ -f "$(dirname "${BASH_SOURCE[0]}")/oss-api-curl.sh" ]]; then source "$(dirname "${BASH_SOURCE[0]}")/oss-api-curl.sh"; fi  # oss_api_curl: API key via stdin, never argv

CONFIG_FILE=$(oss_config_file)
ENDPOINT="/api/v1/prompts/shared/iron-laws?split=1"   # JSON {base, team?}: base is the signed file

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
oss_api_creds || true; API_KEY=$OSS_KEY   # key and URL from one read of one object (T30, T37)

if [[ -z "$API_KEY" ]]; then
  echo "Error: No API key found in config" >&2
  echo "Run /oss:login to configure" >&2
  exit 1
fi

# The key goes only to the API configured beside it
API_URL=$OSS_URL; [[ $OSS_URL_RC == 0 ]] || {
  echo "Error: apiUrl in $CONFIG_FILE must be an https URL (plain http only for localhost) with no user@, query or fragment" >&2
  exit 1
}

# Fetch IRON LAWS with authentication: at most OSS_BODY_MAX bytes, over it curl exit 63 (T74b)
CURL_STATUS=0
RESPONSE=$(oss_capped oss_api_curl "$API_KEY" -s --max-time 10 --max-filesize "$OSS_BODY_MAX" -w "\n%{http_code}" \
  -H "Content-Type: application/json" \
  "${API_URL}${ENDPOINT}") || CURL_STATUS=$?

# Over the cap the API was reached: say so, not "could not reach" (T77); same exit code and error record
if [[ "$CURL_STATUS" -eq 63 ]]; then
  echo "Error: the OSS API answer was over $OSS_BODY_MAX bytes, so it was not used (curl exit 63)" >&2
  emit_oss_error --code OSS-API-003 --severity HIGH \
    --message "IRON LAWS fetch failed: answer over $OSS_BODY_MAX bytes (curl exit 63)" \
    --retry-eligible true --retry-cost cheap
  exit 63
fi
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

# Verify the base laws before anything is printed (R-273 D12). The JSON escapes every newline, so BODY holds the
# reply whole; base and team are taken from it byte for byte into a private work dir.
WORK=$(mktemp -d "${TMPDIR:-/tmp}/oss-fetch-iron-laws.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
printf '%s\n' "$BODY" > "$WORK/reply"
if ! oss_split_field base < "$WORK/reply" > "$WORK/base" || ! oss_split_field team < "$WORK/reply" > "$WORK/team"; then
  echo "Error: the OSS API answer is not the ?split=1 JSON {base, team}; no laws printed" >&2
  exit 1
fi
# Only exit 0 from oss_verify_body (oss-api-curl.sh) prints; any other code prints nothing.
VERIFY_STATUS=0
oss_verify_body shared/iron-laws < "$WORK/base" || VERIFY_STATUS=$?
if [[ "$VERIFY_STATUS" -ne 0 ]]; then
  echo "Error: the laws did not pass verification (oss-decrypt --verify-body exit $VERIFY_STATUS: not the signed laws, or oss-decrypt is older than 1.2.5 and the next /oss command updates it); no laws printed" >&2
  exit 1
fi

# Output result
if [[ "$RAW_OUTPUT" == "true" ]]; then
  cat "$WORK/reply"
else
  cat "$WORK/base" "$WORK/team"
fi
