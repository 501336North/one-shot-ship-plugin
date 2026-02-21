#!/bin/bash
# OSS Version Check - Warns if Claude Code is below minimum recommended version
# Called from oss-session-start.sh
# Exits 0 always (never blocks session start)

MIN_MAJOR=2
MIN_MINOR=1
MIN_PATCH=50

# Check if claude CLI is available
if ! command -v claude &>/dev/null; then
    exit 0
fi

# Get version string (format: "X.Y.Z (Claude Code)")
VERSION_OUTPUT=$(claude --version 2>/dev/null || true)
if [[ -z "$VERSION_OUTPUT" ]]; then
    exit 0
fi

# Parse version: extract X.Y.Z from the output
VERSION=$(echo "$VERSION_OUTPUT" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ -z "$VERSION" ]]; then
    exit 0
fi

# Split into major.minor.patch
IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"

# Compare versions
BELOW=false
if [[ "$MAJOR" -lt "$MIN_MAJOR" ]]; then
    BELOW=true
elif [[ "$MAJOR" -eq "$MIN_MAJOR" && "$MINOR" -lt "$MIN_MINOR" ]]; then
    BELOW=true
elif [[ "$MAJOR" -eq "$MIN_MAJOR" && "$MINOR" -eq "$MIN_MINOR" && "$PATCH" -lt "$MIN_PATCH" ]]; then
    BELOW=true
fi

if [[ "$BELOW" == "true" ]]; then
    echo "OSS: Claude Code v2.1.50+ recommended (current: $VERSION). Upgrade for memory fixes and worktree support."
fi

exit 0
