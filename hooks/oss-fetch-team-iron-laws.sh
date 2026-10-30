#!/bin/bash
# oss-fetch-team-iron-laws.sh - Fetch team-specific IRON LAWS configuration from API
#
# Usage:
#   oss-fetch-team-iron-laws.sh [--force]
#
# Options:
#   --force    Bypass cache and fetch fresh config
#
# Returns JSON config for team-customized IRON LAWS enforcement.
# Caches config locally for 1 hour to reduce API calls.
#
# Output format:
# {
#   "law1_tdd": {"enabled": true, "locked": true},
#   "law2_behavior_tests": {"enabled": true, "locked": false},
#   "law3_loop_detection": {"enabled": true, "locked": true},
#   "law4_git_flow": {"enabled": true, "locked": false, "config": {"protectedBranches": ["main"]}},
#   "law5_agent_delegation": {"enabled": true, "locked": true},
#   "law6_dev_docs": {"enabled": true, "locked": false, "config": {"requiredDocs": ["PROGRESS.md"]}}
# }

set -euo pipefail
if [[ -f "$(dirname "${BASH_SOURCE[0]}")/oss-api-curl.sh" ]]; then source "$(dirname "${BASH_SOURCE[0]}")/oss-api-curl.sh"; fi  # oss_api_curl: API key via stdin, never argv

CONFIG_FILE=$(oss_config_file)
CACHE_FILE="${HOME}/.oss/team-iron-laws.json"
CACHE_SRC_FILE="${CACHE_FILE}.src"  # the request URL the cache came from; another API's cache is never served
CACHE_TTL=3600  # 1 hour in seconds
BACKOFF_FILE="${HOME}/.oss/.team-iron-laws-backoff"  # set by a failed fetch, as oss-iron-laws-sync.sh does
BACKOFF_SECONDS=3600  # 1 hour: no request (and no 10 s wait) after a failure

# Default config when no team/API available
DEFAULT_CONFIG='{
  "law1_tdd": {"enabled": true, "locked": true},
  "law2_behavior_tests": {"enabled": true, "locked": false},
  "law3_loop_detection": {"enabled": true, "locked": true},
  "law4_git_flow": {"enabled": true, "locked": false, "config": {"protectedBranches": ["main", "master"]}},
  "law5_agent_delegation": {"enabled": true, "locked": true},
  "law6_dev_docs": {"enabled": true, "locked": false, "config": {"requiredDocs": ["PROGRESS.md"]}}
}'

# Parse arguments
FORCE_FETCH=false
for arg in "$@"; do
  case $arg in
    --force)
      FORCE_FETCH=true
      shift
      ;;
  esac
done

# Ensure cache directory exists
mkdir -p "$(dirname "$CACHE_FILE")"

# apiKey, apiUrl and teamId from ONE read of the config (oss_config_strings): one JSON object, so the key never
# pairs with another document's URL (T30). A config it refuses gives no key, so no request.
API_KEY=""; RAW_URL=""; TEAM_ID=""
if [[ -e "$CONFIG_FILE" ]] && CFG=$(oss_config_strings apiKey,apiUrl,teamId); then
  API_KEY=${CFG%% *}; CFG=${CFG#* }; RAW_URL=${CFG%% *}; TEAM_ID=${CFG#* }
fi

# Determine endpoint based on team membership
TEAM_ID_RE='^[A-Za-z0-9_-]+$'
if [[ -z "$TEAM_ID" ]]; then
  # Solo user - use defaults endpoint
  ENDPOINT="/api/v1/iron-laws/defaults"
elif [[ ! "$TEAM_ID" =~ $TEAM_ID_RE ]]; then
  # A teamId that is not a plain id would change the request path (../, ?, #): no request (S6)
  ENDPOINT=""
else
  # Team user - fetch team-specific config
  ENDPOINT="/api/v1/iron-laws/team/${TEAM_ID}"
fi

# The key goes only to the API configured beside it: a refused apiUrl or teamId makes no request
# and falls back like an unreachable API. SRC is empty then, so no cache matches it.
SRC=""
if [[ -n "$ENDPOINT" ]] && API_URL=$(oss_api_url_check "$RAW_URL"); then SRC="${API_URL}${ENDPOINT}"; fi
# Every state file here is read only when oss_is_regular (a FIFO is never opened, a symlink never trusted) and
# written only through oss_write_atomic (a symlink at the path is replaced, not followed) (T32).
cache_matches() {
  [[ -n "$SRC" ]] && oss_is_regular "$CACHE_FILE" && oss_is_regular "$CACHE_SRC_FILE" \
    && [[ "$(cat "$CACHE_SRC_FILE" 2>/dev/null)" == "$SRC" ]]
}

# younger_than <file> <seconds>: the file is a regular file (oss_is_regular) modified less than <seconds> ago
# (cross-platform mtime: macOS uses -f %m, Linux uses -c %Y).
younger_than() {
  local m
  oss_is_regular "$1" || return 1
  if [[ "$(uname)" == "Darwin" ]]; then m=$(stat -f %m "$1" 2>/dev/null || echo x)
  else m=$(stat -c %Y "$1" 2>/dev/null || echo x); fi
  [[ "$m" =~ ^[0-9]+$ ]] && (( $(date +%s) - m < $2 ))
}

# Check if cache is fresh (skip if --force)
if [[ "$FORCE_FETCH" == "false" ]] && cache_matches && younger_than "$CACHE_FILE" "$CACHE_TTL"; then
  cat "$CACHE_FILE"
  exit 0
fi

# Not logged in (no config file, or no key in it): return default config
if [[ ! -f "$CONFIG_FILE" || -z "$API_KEY" ]]; then
  echo "$DEFAULT_CONFIG" | tr -d '\n' | tr -s ' '
  exit 0
fi

# Inside the backoff after a failure, no request (skip if --force).
if [[ "$FORCE_FETCH" == "false" ]] && younger_than "$BACKOFF_FILE" "$BACKOFF_SECONDS"; then
  RESPONSE=$'\n000'
# Fetch from API with timeout.
elif [[ -n "$SRC" ]]; then
  RESPONSE=$(oss_api_curl "$API_KEY" -s -w "\n%{http_code}" \
    --max-time 10 \
    -H "Content-Type: application/json" \
    "$SRC" 2>/dev/null || echo -e "\n000")
  [[ "$(echo "$RESPONSE" | tail -n1)" == "200" ]] || oss_write_atomic "$BACKOFF_FILE" "" || true
else
  RESPONSE=$'\n000'
fi

# Extract HTTP status code (last line)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Handle response
if [[ "$HTTP_CODE" == "200" ]]; then
  # Cache the successful response. The old source goes first, so a cut-short write is never
  # read as the old API's cache.
  rm -f "$CACHE_SRC_FILE"
  oss_write_atomic "$CACHE_FILE" "$BODY"$'\n' && oss_write_atomic "$CACHE_SRC_FILE" "$SRC"$'\n' || true
  echo "$BODY"
elif cache_matches; then
  # Return stale cache from this same API on error (better than nothing)
  cat "$CACHE_FILE"
else
  # Return default config as last resort
  echo "$DEFAULT_CONFIG" | tr -d '\n' | tr -s ' '
fi
