#!/bin/bash
# OSS Session End Hook (PreCompact)
# Triggered on: PreCompact (before context compaction)
# Saves local context for restoration (no proprietary content)

# Ensure ~/.oss directory exists
mkdir -p ~/.oss

# Only save context in git repositories
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    exit 0
fi

# Gather context to preserve
BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
REPO_NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" || echo "unknown")
LAST_COMMITS=$(git log -3 --oneline 2>/dev/null || echo "none")
UNCOMMITTED=$(git status -s 2>/dev/null || echo "")
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Save context to file
cat > ~/.oss/session-context.md << EOF
## Restored Session Context
_Saved: $TIMESTAMP_

**Repository:** $REPO_NAME
**Branch:** $BRANCH

**Recent commits:**
\`\`\`
$LAST_COMMITS
\`\`\`
EOF

# Add uncommitted changes if any
if [[ -n "$UNCOMMITTED" ]]; then
    cat >> ~/.oss/session-context.md << EOF

**Uncommitted changes:**
\`\`\`
$UNCOMMITTED
\`\`\`
EOF
fi

exit 0
