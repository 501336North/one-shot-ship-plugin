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

# Paths. `--` before the state file in every jq call: a relative OSS_CONFIG_DIR such as "-cfg" is a path, never
# options (T47).
CONFIG_DIR="${OSS_CONFIG_DIR:-$HOME/.oss}"
STATE_FILE="$CONFIG_DIR/update-state.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_JSON="${OSS_PLUGIN_JSON:-$SCRIPT_DIR/../.claude-plugin/plugin.json}"
# oss_is_regular: the state is read only as a regular file; a link or FIFO counts as no state (T53b). Without the
# helper, no state is trusted.
source "$SCRIPT_DIR/oss-api-curl.sh" 2>/dev/null || oss_is_regular() { return 1; }

# Read current plugin version
current_version=""
if [[ -f "$PLUGIN_JSON" ]] && command -v jq &>/dev/null; then
    current_version=$(jq -r '.version // ""' "$PLUGIN_JSON" 2>/dev/null)
fi

# Read cached state
cached_version=""
has_state=false
if oss_is_regular "$STATE_FILE" && command -v jq &>/dev/null; then
    has_state=true
    cached_version=$(jq -r '.lastPluginVersion // ""' -- "$STATE_FILE" 2>/dev/null)
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
        # At most OSS_BODY_MAX bytes; a larger manifest is none (T74b)
        manifest_json=$(oss_capped curl -s --max-time 3 --max-filesize "$OSS_BODY_MAX" "$manifest_url" 2>/dev/null) || manifest_json=""
    fi

    if [[ -n "$manifest_json" && "$has_state" == true ]] && command -v jq &>/dev/null; then
        cached_hashes=$(jq -c '.manifestHashes // {}' -- "$STATE_FILE" 2>/dev/null)

        # The manifest is fetched without authentication: its keys are data. One jq pass over the manifest and the
        # cached hashes (--slurpfile, never filter text) lists the updated and the new prompts in key order, each
        # name one line without C0 (so a line break too) or oss_invisible (T74, T79). A per-key loop ran two jq
        # per key: minutes at the 256 KB cap. Hashes compare as the text the loop compared.
        diff_text=$(printf '%s' "$manifest_json" | jq -r --slurpfile old <(printf '%s' "$cached_hashes") "$OSS_JQ_INVISIBLE"'
            def h: if type == "string" then . else tojson end;
            def show: gsub("[\u0000-\u001f" + oss_invisible + "]"; "");
            (($old[0] // {}) | if type == "object" then . else {} end) as $o
            | [.prompts | objects | keys[] as $k
               | ((try .[$k].hash catch null) // "" | h) as $new | (($o[$k] // "") | h) as $was
               | if $was == "" or $was == "null" then {n: $k} elif $was != $new then {c: $k} else empty end] as $d
            | [$d[] | .c // empty] as $c | [$d[] | .n // empty] as $n
            | (if ($c | length) > 0 then "Updated prompts (\($c | length)):", ($c[] | "  • " + show), "" else empty end),
              (if ($n | length) > 0 then "New prompts (\($n | length)):", ($n[] | "  + " + show), "" else empty end)' 2>/dev/null)

        if [[ -n "$diff_text" ]]; then
            printf '%s\n\n' "$diff_text"
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
    last_checked=$(jq -r '.lastCheckedAt // "unknown"' -- "$STATE_FILE" 2>/dev/null)
    echo "Last checked: $last_checked"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
