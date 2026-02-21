#!/bin/bash
# OSS Worktree Create Hook
# Triggered on: WorktreeCreate
# Sets up .oss/ state directory in new worktree with auth and workflow state

WORKTREE_PATH="${CLAUDE_WORKTREE_PATH:-}"
if [[ -z "$WORKTREE_PATH" ]]; then
    exit 0
fi

# Create .oss/ directory in worktree
mkdir -p "$WORKTREE_PATH/.oss"

# Copy auth config from home directory (shared credentials)
if [[ -f "$HOME/.oss/config.json" ]]; then
    cp "$HOME/.oss/config.json" "$WORKTREE_PATH/.oss/config.json"
    chmod 600 "$WORKTREE_PATH/.oss/config.json"
fi

# Initialize workflow-state.json with defaults
cat > "$WORKTREE_PATH/.oss/workflow-state.json" << 'EOF'
{
  "activeStep": null,
  "currentCommand": null,
  "tddPhase": null,
  "supervisorStatus": "watching",
  "workflowComplete": false
}
EOF

exit 0
