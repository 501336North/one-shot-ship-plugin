#!/bin/bash
# fetch-iron-laws.sh - Fetch IRON LAWS from API with authentication
#
# Usage:
#   fetch-iron-laws.sh [--raw]
#
# Options:
#   --raw    Print the verified body as is (default: extract a JSON "content" field if present)
#
# Prints the IRON LAWS, fetched and verified by the decrypt CLI (ship round 1 FR15): it checks the
# body's sha256 against the signed manifest entry shared/iron-laws and refuses on any failure, so
# unverified laws are never printed. ensure-decrypt-cli.sh installs or upgrades the CLI first, every time.
# Below them: the team/personal section (oss_custom_iron_laws, SR16), after one line saying it is unverified.
#
# Exit codes: 0 laws printed; 1 not logged in, CLI missing and not installable, auth failure,
# laws refused; otherwise the CLI's exit code (API unreachable or other failure).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/oss-api-curl.sh" ]]; then source "$SCRIPT_DIR/oss-api-curl.sh"; fi  # oss_config_file, oss_api_url

CONFIG_FILE="$(oss_config_file)"  # logged in; the decrypt CLI reads its own credentials
oss_api_url >/dev/null || { echo "Error: apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment" >&2; exit 1; }
OSS_DECRYPT="$HOME/.oss/bin/oss-decrypt"

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

# Install or upgrade the decrypt CLI to the pinned version, every time (SR6): an outdated or wrong-channel CLI is
# replaced; it exits at once when the pin is met. On failure the installed CLI is not used.
if ! "$SCRIPT_DIR/ensure-decrypt-cli.sh" </dev/null >&2; then
  echo "Error: the decrypt CLI could not be installed or updated to the pinned version" >&2
  exit 1
fi

# Fetch the verified IRON LAWS. Nothing is printed unless the CLI exits 0.
CLI_STATUS=0
CLI_ERR=$(mktemp "${TMPDIR:-/tmp}/oss-fetch-iron-laws.XXXXXX")
trap 'rm -f "$CLI_ERR"' EXIT
BODY=$("$OSS_DECRYPT" --type shared --name iron-laws 2>"$CLI_ERR") || CLI_STATUS=$?

if [[ "$CLI_STATUS" -ne 0 ]]; then
  REASON=$(tail -n 1 "$CLI_ERR")
  echo "Error: could not get verified IRON LAWS (oss-decrypt exit $CLI_STATUS): $REASON" >&2
  case "$REASON" in
    *Unauthorized*)
      echo "Authentication failed. Run /oss:login to refresh credentials" >&2
      emit_oss_error --code OSS-AUTH-001 --severity HIGH \
        --message "IRON LAWS fetch failed: authentication rejected (HTTP 401)" \
        --retry-eligible false
      exit 1
      ;;
    *SECURITY*)
      echo "The IRON LAWS were refused: they did not match the signed manifest" >&2
      emit_oss_error --code OSS-API-002 --severity HIGH \
        --message "IRON LAWS refused: not verified against the signed manifest" \
        --retry-eligible false
      exit 1
      ;;
  esac
  emit_oss_error --code OSS-API-003 --severity HIGH \
    --message "IRON LAWS fetch failed (oss-decrypt exit $CLI_STATUS)" \
    --retry-eligible true --retry-cost cheap
  exit "$CLI_STATUS"
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

# Below the verified laws: the team/personal section, marked unverified (SR16); none or a failed fetch: the laws alone.
if CUSTOM=$(oss_custom_iron_laws); then
  printf '\n%s\n\n%s\n' "$OSS_CUSTOM_LAWS_NOTE" "$CUSTOM"
fi
