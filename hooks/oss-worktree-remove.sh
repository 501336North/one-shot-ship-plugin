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
# Through the guard (ADR-1): only delete inside a real, user-owned .oss - never through a
# committed .oss link (rm of a link entry itself is safe; rm under a linked dir is not).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/oss-safe-path.sh" ]]; then source "$SCRIPT_DIR/oss-safe-path.sh"; fi
if ! oss_safe_mkdir "$WORKTREE_PATH" .oss; then
    oss_refuse_unsafe .oss
    exit 0
fi

# Remove state files (not dev docs)
rm -f "$OSS_DIR/workflow-state.json"
rm -f "$OSS_DIR/config.json"
rm -f "$OSS_DIR/workflow.log"
rm -rf "$OSS_DIR/logs"
rm -rf "$OSS_DIR/hooks"

exit 0
