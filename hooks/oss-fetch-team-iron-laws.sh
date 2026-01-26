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

CONFIG_FILE="${HOME}/.oss/config.json"
CACHE_FILE="${HOME}/.oss/team-iron-laws.json"
CACHE_TTL=3600  # 1 hour in seconds
API_URL="https://one-shot-ship-api.onrender.com"

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

# Check if cache is fresh (skip if --force)
if [[ "$FORCE_FETCH" == "false" && -f "$CACHE_FILE" ]]; then
  # Get cache age (cross-platform: macOS uses -f %m, Linux uses -c %Y)
  if [[ "$(uname)" == "Darwin" ]]; then
    CACHE_MTIME=$(stat -f %m "$CACHE_FILE" 2>/dev/null || echo 0)
  else
    CACHE_MTIME=$(stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0)
  fi
  CURRENT_TIME=$(date +%s)
  CACHE_AGE=$((CURRENT_TIME - CACHE_MTIME))

  if [[ $CACHE_AGE -lt $CACHE_TTL ]]; then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

# Check if config file exists
if [[ ! -f "$CONFIG_FILE" ]]; then
  # Return default config if not logged in
  echo "$DEFAULT_CONFIG" | tr -d '\n' | tr -s ' '
  exit 0
fi

# Extract API key from config
API_KEY=$(grep -o '"apiKey"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" 2>/dev/null | sed 's/.*: *"\([^"]*\)"/\1/' || echo "")

if [[ -z "$API_KEY" ]]; then
  # Return default config if not logged in
  echo "$DEFAULT_CONFIG" | tr -d '\n' | tr -s ' '
  exit 0
fi

# Get team ID from config (if user is in a team)
TEAM_ID=$(grep -o '"teamId"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" 2>/dev/null | sed 's/.*: *"\([^"]*\)"/\1/' || echo "")

# Determine endpoint based on team membership
if [[ -z "$TEAM_ID" ]]; then
  # Solo user - use defaults endpoint
  ENDPOINT="/api/v1/iron-laws/defaults"
else
  # Team user - fetch team-specific config
  ENDPOINT="/api/v1/iron-laws/team/${TEAM_ID}"
fi

# Fetch from API with timeout
RESPONSE=$(curl -s -w "\n%{http_code}" \
  --max-time 10 \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  "${API_URL}${ENDPOINT}" 2>/dev/null || echo -e "\n000")

# Extract HTTP status code (last line)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Handle response
if [[ "$HTTP_CODE" == "200" ]]; then
  # Cache the successful response
  echo "$BODY" > "$CACHE_FILE"
  echo "$BODY"
elif [[ -f "$CACHE_FILE" ]]; then
  # Return stale cache on error (better than nothing)
  cat "$CACHE_FILE"
else
  # Return default config as last resort
  echo "$DEFAULT_CONFIG" | tr -d '\n' | tr -s ' '
fi
