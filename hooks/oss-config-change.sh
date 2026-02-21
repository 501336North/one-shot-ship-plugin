#!/bin/bash
# OSS Config Change Guard
# Triggered on: ConfigChange
# Warns when users change settings that would break OSS functionality

SETTINGS_FILE="$HOME/.claude/settings.json"

if [[ ! -f "$SETTINGS_FILE" ]]; then
    exit 0
fi

# Check if hooks are disabled
if command -v jq &>/dev/null; then
    HOOKS_ENABLED=$(jq -r 'if .hooks.enabled == false then "disabled" else "ok" end' "$SETTINGS_FILE" 2>/dev/null)
    if [[ "$HOOKS_ENABLED" == "disabled" ]]; then
        echo "OSS: Warning - Hooks are disabled in settings. OSS requires hooks to function. Re-enable hooks to restore OSS functionality."
    fi

    # Check if plugin list exists but OSS plugin is missing
    HAS_PLUGINS=$(jq 'has("plugins")' "$SETTINGS_FILE" 2>/dev/null)
    if [[ "$HAS_PLUGINS" == "true" ]]; then
        OSS_FOUND=$(jq -r '.plugins[]?' "$SETTINGS_FILE" 2>/dev/null | grep -ci "oss" || true)
        if [[ "$OSS_FOUND" -eq 0 ]]; then
            echo "OSS: Warning - OSS plugin removed from settings. OSS commands and hooks will not work."
        fi
    fi
else
    # Fallback: basic grep checks
    if grep -q '"enabled"[[:space:]]*:[[:space:]]*false' "$SETTINGS_FILE" 2>/dev/null; then
        echo "OSS: Warning - Hooks may be disabled. Check settings.json."
    fi
fi

exit 0
