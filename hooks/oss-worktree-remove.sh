#!/bin/bash
# OSS Worktree Remove Hook
# Triggered on: WorktreeRemove
# Cleans up .oss/ state files but preserves dev docs

WORKTREE_PATH="${CLAUDE_WORKTREE_PATH:-}"
if [[ -z "$WORKTREE_PATH" ]]; then
    exit 0
fi

OSS_DIR="$WORKTREE_PATH/.oss"
if [[ ! -d "$OSS_DIR" ]]; then
    exit 0
fi

# Remove state files (not dev docs)
rm -f "$OSS_DIR/workflow-state.json"
rm -f "$OSS_DIR/config.json"
rm -f "$OSS_DIR/workflow.log"
rm -rf "$OSS_DIR/logs"
rm -rf "$OSS_DIR/hooks"

exit 0
