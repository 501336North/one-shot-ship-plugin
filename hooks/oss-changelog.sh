#!/bin/bash
# oss-changelog.sh - Display what changed since last session
#
# Shows plugin version changes and prompt updates by comparing
# cached state against current plugin.json and manifest.
#
# Environment variables (for testing):
#   OSS_CONFIG_DIR     - Override config directory (default: ~/.oss)
#   OSS_PLUGIN_JSON    - Override plugin.json path
#   OSS_MOCK_MANIFEST  - Use local file instead of API fetch
#   OSS_SKIP_MANIFEST  - Skip manifest check entirely (set to 1)

set -uo pipefail

# Paths
CONFIG_DIR="${OSS_CONFIG_DIR:-$HOME/.oss}"
STATE_FILE="$CONFIG_DIR/update-state.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_JSON="${OSS_PLUGIN_JSON:-$SCRIPT_DIR/../.claude-plugin/plugin.json}"

# Read current plugin version
current_version=""
if [[ -f "$PLUGIN_JSON" ]] && command -v jq &>/dev/null; then
    current_version=$(jq -r '.version // ""' "$PLUGIN_JSON" 2>/dev/null)
fi

# Read cached state
cached_version=""
has_state=false
if [[ -f "$STATE_FILE" ]] && command -v jq &>/dev/null; then
    has_state=true
    cached_version=$(jq -r '.lastPluginVersion // ""' "$STATE_FILE" 2>/dev/null)
fi

# Header
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  OSS Changelog"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

changes_found=false

# Plugin version change
if [[ -n "$cached_version" && -n "$current_version" && "$cached_version" != "$current_version" ]]; then
    echo "Plugin: v${cached_version} → v${current_version}"
    echo ""
    changes_found=true
elif [[ "$has_state" == false ]]; then
    echo "Plugin: v${current_version} (first run — no previous state)"
    echo ""
fi

# Manifest diff
skip_manifest="${OSS_SKIP_MANIFEST:-0}"
if [[ "$skip_manifest" != "1" ]]; then
    manifest_json=""
    if [[ -n "${OSS_MOCK_MANIFEST:-}" && -f "${OSS_MOCK_MANIFEST:-}" ]]; then
        manifest_json=$(cat "$OSS_MOCK_MANIFEST")
    else
        manifest_url="${OSS_MANIFEST_URL:-https://one-shot-ship-api.onrender.com/api/v1/prompts/manifest}"
        manifest_json=$(curl -s --max-time 3 "$manifest_url" 2>/dev/null) || manifest_json=""
    fi

    if [[ -n "$manifest_json" && "$has_state" == true ]] && command -v jq &>/dev/null; then
        cached_hashes=$(jq -r '.manifestHashes // {}' "$STATE_FILE" 2>/dev/null)
        changed_prompts=()
        new_prompts=()

        for key in $(echo "$manifest_json" | jq -r '.prompts | keys[]' 2>/dev/null); do
            new_hash=$(echo "$manifest_json" | jq -r ".prompts[\"$key\"].hash // \"\"" 2>/dev/null)
            old_hash=$(echo "$cached_hashes" | jq -r ".[\"$key\"] // \"\"" 2>/dev/null)

            if [[ -z "$old_hash" || "$old_hash" == "null" ]]; then
                new_prompts+=("$key")
            elif [[ "$old_hash" != "$new_hash" ]]; then
                changed_prompts+=("$key")
            fi
        done

        if [[ ${#changed_prompts[@]} -gt 0 ]]; then
            echo "Updated prompts (${#changed_prompts[@]}):"
            for p in "${changed_prompts[@]}"; do
                # Categorize by type prefix
                echo "  • $p"
            done
            echo ""
            changes_found=true
        fi

        if [[ ${#new_prompts[@]} -gt 0 ]]; then
            echo "New prompts (${#new_prompts[@]}):"
            for p in "${new_prompts[@]}"; do
                echo "  + $p"
            done
            echo ""
            changes_found=true
        fi
    fi
fi

if [[ "$changes_found" == false ]]; then
    echo "No updates since last check. You're up to date."
    echo ""
fi

# Footer
if [[ "$has_state" == true ]]; then
    last_checked=$(jq -r '.lastCheckedAt // "unknown"' "$STATE_FILE" 2>/dev/null)
    echo "Last checked: $last_checked"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
