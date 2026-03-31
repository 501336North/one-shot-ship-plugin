#!/bin/bash
# oss-setup-permissions.sh - Create .claude/settings.local.json with OSS permissions
#
# Usage: oss-setup-permissions.sh [PROJECT_DIR]
#
# Creates .claude/settings.local.json in the project directory with pre-approved
# permissions for all OSS hooks and binaries. If the file already exists, merges
# OSS entries without removing existing custom entries.
#
# This eliminates the excessive Claude Code permission prompts that users see
# when starting new projects.

set -euo pipefail

PROJECT_DIR="${1:-${CLAUDE_PROJECT_DIR:-.}}"
SETTINGS_DIR="$PROJECT_DIR/.claude"
SETTINGS_FILE="$SETTINGS_DIR/settings.local.json"

# OSS permission entries — full command prefix (CC matches literally, not as glob)
OSS_PERMISSIONS=(
    'Bash(~/.oss/hooks/oss-log.sh:*)'
    'Bash(~/.oss/hooks/oss-notify.sh:*)'
    'Bash(~/.oss/hooks/oss-iron-laws-sync.sh:*)'
    'Bash(~/.oss/hooks/ensure-decrypt-cli.sh:*)'
    'Bash(~/.oss/hooks/learn-extractor.sh:*)'
    'Bash(~/.oss/hooks/oss-statusline.sh:*)'
    'Bash(~/.oss/hooks/oss-write-learning.sh:*)'
    'Bash(~/.oss/hooks/oss-changelog.sh:*)'
    'Bash(~/.oss/hooks/fetch-iron-laws.sh:*)'
    'Bash(~/.oss/hooks/oss-onboard-check.sh:*)'
    'Bash(~/.oss/hooks/oss-setup-permissions.sh:*)'
    'Bash(~/.oss/hooks/oss-detect-playwright.sh:*)'
    'Bash(~/.oss/bin/oss-decrypt:*)'
    'Bash(~/.oss/oss-statusline.sh:*)'
)

# Create settings directory if needed
mkdir -p "$SETTINGS_DIR"

if [[ ! -f "$SETTINGS_FILE" ]]; then
    # Case 1: No settings file — create fresh
    {
        echo '{'
        echo '  "permissions": {'
        echo '    "allow": ['
        last_idx=$(( ${#OSS_PERMISSIONS[@]} - 1 ))
        for i in "${!OSS_PERMISSIONS[@]}"; do
            if [[ $i -eq $last_idx ]]; then
                echo "      \"${OSS_PERMISSIONS[$i]}\""
            else
                echo "      \"${OSS_PERMISSIONS[$i]}\","
            fi
        done
        echo '    ],'
        echo '    "deny": [],'
        echo '    "ask": []'
        echo '  }'
        echo '}'
    } > "$SETTINGS_FILE"
else
    # Case 2: Settings file exists — merge OSS entries
    # Read existing allow list, add missing OSS entries
    if command -v python3 &>/dev/null; then
        # Build permissions JSON safely via stdin (avoids shell injection)
        OSS_PERMS_JSON=$(printf '%s\n' "${OSS_PERMISSIONS[@]}" | python3 -c "import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))")
        python3 -c "
import json, sys

settings_file = sys.argv[1]
oss_perms = json.loads(sys.argv[2])

with open(settings_file) as f:
    data = json.load(f)

perms = data.get('permissions', {})
allow = perms.get('allow', [])

# Add missing OSS entries
for p in oss_perms:
    if p not in allow:
        allow.append(p)

perms['allow'] = allow
if 'deny' not in perms:
    perms['deny'] = []
if 'ask' not in perms:
    perms['ask'] = []
data['permissions'] = perms

with open(settings_file, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
" "$SETTINGS_FILE" "$OSS_PERMS_JSON"
    else
        # Fallback: no python3 — skip merge, don't overwrite
        # Check if OSS entries already present
        if ! grep -q 'oss-log.sh' "$SETTINGS_FILE" 2>/dev/null; then
            echo "Warning: python3 not available, cannot merge OSS permissions" >&2
        fi
    fi
fi
