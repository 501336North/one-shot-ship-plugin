#!/bin/bash
# check-updates.sh - Session-start update checker
#
# Detects plugin version changes and manifest hash differences.
# Outputs notification text to stdout (consumed by oss-notify.sh).
# Designed to run non-blocking during session start.
#
# Environment variables (for testing):
#   OSS_CONFIG_DIR     - Override config directory (default: ~/.oss)
#   OSS_PLUGIN_JSON    - Override plugin.json path
#   OSS_MOCK_MANIFEST  - Use local file instead of API fetch
#   OSS_SKIP_MANIFEST  - Skip manifest check entirely (set to 1)
#   OSS_MANIFEST_URL   - Override manifest API URL

set -uo pipefail

# Paths
CONFIG_DIR="${OSS_CONFIG_DIR:-$HOME/.oss}"
STATE_FILE="$CONFIG_DIR/update-state.json"
SETTINGS_FILE="$CONFIG_DIR/settings.json"

# Find plugin.json
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_JSON="${OSS_PLUGIN_JSON:-$SCRIPT_DIR/../.claude-plugin/plugin.json}"

# Check if notifications are enabled
if [[ -f "$SETTINGS_FILE" ]] && command -v jq &>/dev/null; then
    updates_enabled=$(jq -r 'if .notifications.updates == false then "false" else "true" end' "$SETTINGS_FILE" 2>/dev/null)
    if [[ "$updates_enabled" == "false" ]]; then
        exit 0
    fi
fi

# Read current plugin version
if [[ ! -f "$PLUGIN_JSON" ]]; then
    exit 0
fi
current_version=$(jq -r '.version // ""' "$PLUGIN_JSON" 2>/dev/null)
release_note=$(jq -r '.releaseNote // ""' "$PLUGIN_JSON" 2>/dev/null)

# Read cached state
cached_version=""
first_run=false
if [[ -f "$STATE_FILE" ]] && command -v jq &>/dev/null; then
    cached_version=$(jq -r '.lastPluginVersion // ""' "$STATE_FILE" 2>/dev/null)
else
    first_run=true
fi

# First run — cache silently, no notification
if [[ "$first_run" == true || -z "$cached_version" ]]; then
    mkdir -p "$CONFIG_DIR"
    # Initialize state
    cat > "$STATE_FILE" << ENDSTATE
{
  "lastPluginVersion": "$current_version",
  "lastCheckedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "manifestVersion": 0,
  "manifestHashes": {},
  "promptSignatures": {}
}
ENDSTATE
    chmod 600 "$STATE_FILE"
    exit 0
fi

# Detect plugin version change
plugin_changed=false
if [[ -n "$current_version" && "$current_version" != "$cached_version" ]]; then
    plugin_changed=true
fi

# Detect manifest hash changes
prompts_changed=0
skip_manifest="${OSS_SKIP_MANIFEST:-0}"

if [[ "$skip_manifest" != "1" ]]; then
    # Fetch manifest (mock or API)
    manifest_json=""
    if [[ -n "${OSS_MOCK_MANIFEST:-}" && -f "${OSS_MOCK_MANIFEST:-}" ]]; then
        manifest_json=$(cat "$OSS_MOCK_MANIFEST")
    else
        manifest_url="${OSS_MANIFEST_URL:-https://one-shot-ship-api.onrender.com/api/v1/prompts/manifest}"
        manifest_json=$(curl -s --max-time 3 "$manifest_url" 2>/dev/null) || manifest_json=""
    fi

    if [[ -n "$manifest_json" ]] && command -v jq &>/dev/null; then
        # Get cached hashes
        cached_hashes=$(jq -r '.manifestHashes // {}' "$STATE_FILE" 2>/dev/null)

        # Compare each prompt hash
        for key in $(echo "$manifest_json" | jq -r '.prompts | keys[]' 2>/dev/null); do
            new_hash=$(echo "$manifest_json" | jq -r ".prompts[\"$key\"].hash // \"\"" 2>/dev/null)
            old_hash=$(echo "$cached_hashes" | jq -r ".[\"$key\"] // \"\"" 2>/dev/null)

            if [[ -n "$old_hash" && -n "$new_hash" && "$old_hash" != "$new_hash" ]]; then
                ((prompts_changed++))
            fi
        done

        # Update cached manifest hashes
        new_hashes=$(echo "$manifest_json" | jq '{manifestHashes: (.prompts | to_entries | map({(.key): .value.hash}) | add // {})}' 2>/dev/null)
        if [[ -n "$new_hashes" ]]; then
            # Merge new hashes into state
            merged=$(jq -s '.[0] * .[1]' "$STATE_FILE" <(echo "$new_hashes") 2>/dev/null)
            if [[ -n "$merged" ]]; then
                echo "$merged" > "$STATE_FILE"
                chmod 600 "$STATE_FILE"
            fi
        fi
    fi
fi

# Build notification message
notification=""

if [[ "$plugin_changed" == true && $prompts_changed -gt 0 ]]; then
    # Combined notification
    if [[ -n "$release_note" ]]; then
        notification="✨ OSS v${current_version} — ${release_note} + ${prompts_changed} prompts improved → /oss:changelog"
    else
        notification="✨ OSS v${current_version} + ${prompts_changed} prompts improved → /oss:changelog"
    fi
elif [[ "$plugin_changed" == true ]]; then
    # Plugin only
    if [[ -n "$release_note" ]]; then
        notification="✨ OSS v${current_version} — ${release_note} → /oss:changelog"
    else
        notification="✨ OSS v${current_version} → /oss:changelog"
    fi
elif [[ $prompts_changed -gt 0 ]]; then
    # Prompts only
    notification="📡 OSS update: ${prompts_changed} prompts improved → /oss:changelog"
fi

# Update cached plugin version
if [[ "$plugin_changed" == true ]]; then
    updated=$(jq --arg v "$current_version" '.lastPluginVersion = $v' "$STATE_FILE" 2>/dev/null)
    if [[ -n "$updated" ]]; then
        echo "$updated" > "$STATE_FILE"
        chmod 600 "$STATE_FILE"
    fi
fi

# Update lastCheckedAt
updated=$(jq --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.lastCheckedAt = $t' "$STATE_FILE" 2>/dev/null)
if [[ -n "$updated" ]]; then
    echo "$updated" > "$STATE_FILE"
    chmod 600 "$STATE_FILE"
fi

# Output notification (consumed by caller)
if [[ -n "$notification" ]]; then
    echo "$notification"
fi
