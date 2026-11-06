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

# Paths. `--` before each one in jq and mkdir: a relative OSS_CONFIG_DIR such as "-cfg" is a path, never options (T47).
CONFIG_DIR="${OSS_CONFIG_DIR:-$HOME/.oss}"
STATE_FILE="$CONFIG_DIR/update-state.json"
SETTINGS_FILE="$CONFIG_DIR/settings.json"

# Find plugin.json
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_JSON="${OSS_PLUGIN_JSON:-$SCRIPT_DIR/../.claude-plugin/plugin.json}"

# The state file is read only as a regular file (oss_is_regular) and written only through oss_write_atomic (temp +
# mv, mode 0600), so a FIFO there never hangs the check and a symlink is never followed (T53, as T32). No helpers:
# skip the check silently; it is best-effort.
source "$SCRIPT_DIR/oss-api-curl.sh" 2>/dev/null || exit 0

# Check if notifications are enabled. A symlinked settings.json is followed on purpose (user choice 2026-11-02:
# dotfile managers such as stow or chezmoi keep notices off); -f refuses a FIFO, so it never hangs (T53b).
if [[ -f "$SETTINGS_FILE" ]] && command -v jq &>/dev/null; then
    updates_enabled=$(jq -r 'if .notifications.updates == false then "false" else "true" end' -- "$SETTINGS_FILE" 2>/dev/null)
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
if oss_is_regular "$STATE_FILE" && command -v jq &>/dev/null; then   # else missing: cache again (T53)
    cached_version=$(jq -r '.lastPluginVersion // ""' -- "$STATE_FILE" 2>/dev/null)
else
    first_run=true
fi

# First run — cache silently, no notification
if [[ "$first_run" == true || -z "$cached_version" ]]; then
    mkdir -p -- "$CONFIG_DIR"
    # Initialize state
    oss_write_atomic "$STATE_FILE" "$(cat << ENDSTATE
{
  "lastPluginVersion": "$current_version",
  "lastCheckedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "manifestVersion": 0,
  "manifestHashes": {},
  "promptSignatures": {}
}
ENDSTATE
)"$'\n'
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
        # At most OSS_BODY_MAX bytes; a larger manifest is none (T74b)
        manifest_json=$(oss_capped curl -s --max-time 3 --max-filesize "$OSS_BODY_MAX" "$manifest_url" 2>/dev/null) || manifest_json=""
    fi

    if [[ -n "$manifest_json" ]] && command -v jq &>/dev/null; then
        # Get cached hashes
        cached_hashes=$(jq -c '.manifestHashes // {}' -- "$STATE_FILE" 2>/dev/null)

        # Count the prompts whose cached hash changed. The manifest is fetched without authentication: its keys are
        # data, compared in one jq pass over the manifest and the cached hashes (--slurpfile, never filter text), so
        # a key with a line break is one key (T74, T79). A per-key loop ran two jq per key and, at the 256 KB cap,
        # outlasted session start's 3 s bound before the hashes below were saved. Only the count is printed.
        prompts_changed=$(printf '%s' "$manifest_json" | jq -r --slurpfile old <(printf '%s' "$cached_hashes") '
            def h: if type == "string" then . else tojson end;
            (($old[0] // {}) | if type == "object" then . else {} end) as $o
            | [.prompts | objects | keys[] as $k
               | select(((try .[$k].hash catch null) // "" | h) as $new | (($o[$k] // "") | h) as $was
                        | $was != "" and $new != "" and $was != $new)] | length' 2>/dev/null)
        [[ "$prompts_changed" =~ ^[0-9]+$ ]] || prompts_changed=0

        # Update cached manifest hashes
        new_hashes=$(echo "$manifest_json" | jq '{manifestHashes: (.prompts | to_entries | map({(.key): .value.hash}) | add // {})}' 2>/dev/null)
        if [[ -n "$new_hashes" ]]; then
            # Merge new hashes into state
            merged=$(jq -s '.[0] * .[1]' -- "$STATE_FILE" <(echo "$new_hashes") 2>/dev/null)
            if [[ -n "$merged" ]]; then
                oss_write_atomic "$STATE_FILE" "$merged"$'\n'
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
    updated=$(jq --arg v "$current_version" '.lastPluginVersion = $v' -- "$STATE_FILE" 2>/dev/null)
    if [[ -n "$updated" ]]; then
        oss_write_atomic "$STATE_FILE" "$updated"$'\n'
    fi
fi

# Update lastCheckedAt
updated=$(jq --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.lastCheckedAt = $t' -- "$STATE_FILE" 2>/dev/null)
if [[ -n "$updated" ]]; then
    oss_write_atomic "$STATE_FILE" "$updated"$'\n'
fi

# Output notification (consumed by caller)
if [[ -n "$notification" ]]; then
    echo "$notification"
fi
