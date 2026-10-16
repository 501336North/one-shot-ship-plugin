#!/bin/bash
# oss-iron-laws-sync.sh - Sync Iron Laws into CLAUDE.md at session start
#
# Usage:
#   oss-iron-laws-sync.sh
#
# Environment:
#   CLAUDE_PROJECT_DIR - Project directory (defaults to current dir)
#   HOME - User home directory
#
# Behavior:
#   - If CLAUDE.md has fresh Iron Laws (cache <24h): exit 0, no output
#   - If cache is stale: fetch from API, update CLAUDE.md
#   - If CLAUDE.md missing or has no markers: create/append + output to stdout
#
# Exit codes:
#   0 - Success (Iron Laws are in CLAUDE.md)
#   1 - Error (no API key, API failure)

set -euo pipefail

CONFIG_FILE="${HOME}/.oss/config.json"
API_URL="https://one-shot-ship-api.onrender.com"
ENDPOINT="/api/v1/prompts/shared/iron-laws"
CLAUDE_MD="${CLAUDE_PROJECT_DIR:-.}/CLAUDE.md"
HASH_FILE="${HOME}/.oss/.iron-laws-hash"
LAST_CHECK_FILE="${HOME}/.oss/.iron-laws-last-check"
CACHE_TTL_SECONDS=86400  # 24 hours

MARKER_START="<!-- IRON LAWS START - Do not edit manually, updated by /oss:login -->"
MARKER_END="<!-- IRON LAWS END -->"

# Check if CLAUDE.md has Iron Laws markers
has_iron_laws_markers() {
    [[ -f "$CLAUDE_MD" ]] && grep -q "IRON LAWS START" "$CLAUDE_MD" 2>/dev/null
}

# Check if cache is fresh (<24h old)
cache_is_fresh() {
    [[ -f "$LAST_CHECK_FILE" ]] || return 1
    local last_check_epoch now_epoch diff
    if [[ "$(uname)" == "Darwin" ]]; then
        last_check_epoch=$(stat -f %m "$LAST_CHECK_FILE" 2>/dev/null || echo "0")
    else
        last_check_epoch=$(stat -c %Y "$LAST_CHECK_FILE" 2>/dev/null || echo "0")
    fi
    now_epoch=$(date +%s)
    diff=$((now_epoch - last_check_epoch))
    [[ $diff -lt $CACHE_TTL_SECONDS ]]
}

# Fetch Iron Laws from API (shared endpoint, returns plain markdown)
# Note: Iron Laws use the shared/unencrypted endpoint, not oss-decrypt.
# The shared endpoint serves plain markdown to all authenticated users.
fetch_iron_laws() {
    local api_key
    api_key=$(grep -o '"apiKey"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" | sed 's/.*: *"\([^"]*\)"/\1/')

    if [[ -z "$api_key" ]]; then
        echo "Error: No API key found in config" >&2
        return 1
    fi

    local response http_code body
    response=$(curl -s -m 10 -w "\n%{http_code}" \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" \
        "${API_URL}${ENDPOINT}")

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [[ "$http_code" != "200" ]]; then
        echo "Error: API returned status $http_code" >&2
        return 1
    fi

    echo "$body"
}

# Update Iron Laws content between markers in CLAUDE.md
update_between_markers() {
    local new_content="$1"
    local tmp_file
    tmp_file=$(mktemp)

    local in_markers=false
    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" == *"IRON LAWS START"* ]]; then
            echo "$MARKER_START" >> "$tmp_file"
            echo "" >> "$tmp_file"
            echo "$new_content" >> "$tmp_file"
            echo "" >> "$tmp_file"
            in_markers=true
            continue
        fi
        if [[ "$line" == *"IRON LAWS END"* ]]; then
            echo "$MARKER_END" >> "$tmp_file"
            in_markers=false
            continue
        fi
        if [[ "$in_markers" == "false" ]]; then
            echo "$line" >> "$tmp_file"
        fi
    done < "$CLAUDE_MD"

    mv "$tmp_file" "$CLAUDE_MD"
}

# Append Iron Laws section to CLAUDE.md
append_iron_laws() {
    local content="$1"
    echo "" >> "$CLAUDE_MD"
    echo "$MARKER_START" >> "$CLAUDE_MD"
    echo "" >> "$CLAUDE_MD"
    echo "$content" >> "$CLAUDE_MD"
    echo "" >> "$CLAUDE_MD"
    echo "$MARKER_END" >> "$CLAUDE_MD"
}

# Update cache files
update_cache() {
    local content="$1"
    local new_hash
    if command -v md5sum &>/dev/null; then
        new_hash=$(echo "$content" | md5sum | cut -d' ' -f1)
    elif command -v md5 &>/dev/null; then
        new_hash=$(echo "$content" | md5 -q)
    else
        new_hash=$(echo "$content" | cksum | cut -d' ' -f1)
    fi
    mkdir -p "$(dirname "$HASH_FILE")"
    echo "$new_hash" > "$HASH_FILE"
    touch "$LAST_CHECK_FILE"
}

# =============================================================================
# Main logic
# =============================================================================
main() {
    # Check config exists
    if [[ ! -f "$CONFIG_FILE" ]]; then
        echo "Error: Config file not found at $CONFIG_FILE" >&2
        exit 1
    fi

    # Case 1: CLAUDE.md has markers AND cache is fresh → skip (fast path)
    if has_iron_laws_markers && cache_is_fresh; then
        exit 0
    fi

    # Case 2: CLAUDE.md has markers BUT cache is stale → fetch and update
    if has_iron_laws_markers; then
        local content
        content=$(fetch_iron_laws) || exit 0  # Don't fail on API errors when we have existing
        update_between_markers "$content"
        update_cache "$content"
        # No stdout - CLAUDE.md already had Iron Laws, just refreshed
        exit 0
    fi

    # Case 3: CLAUDE.md exists but no markers → fetch, append, stdout
    # Case 4: CLAUDE.md doesn't exist → fetch, create, stdout
    local content
    content=$(fetch_iron_laws) || {
        echo "Error: Failed to fetch Iron Laws from API" >&2
        exit 1
    }

    if [[ -f "$CLAUDE_MD" ]]; then
        # Append to existing file
        append_iron_laws "$content"
    else
        # Create new file
        cat > "$CLAUDE_MD" << NEWFILE
$MARKER_START

$content

$MARKER_END
NEWFILE
    fi

    update_cache "$content"

    # Output to stdout for current session fallback
    echo "$content"
}

main "$@"
