#!/bin/bash
# OSS Worktree Create Hook
# Triggered on: WorktreeCreate
# Sets up .oss/ state directory in new worktree with auth and workflow state

WORKTREE_PATH="${CLAUDE_WORKTREE_PATH:-}"
if [[ -z "$WORKTREE_PATH" ]]; then
    exit 0
fi

# Create .oss/ directory in worktree - through the guard (ADR-1): a committed .oss link, or a
# linked config.json / workflow-state.json, is refused so the API key never lands outside it.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/oss-safe-path.sh" ]]; then source "$SCRIPT_DIR/oss-safe-path.sh"; else oss_safe_mkdir() { return 1; }; oss_safe_target() { return 1; }; oss_valid_workflow_name() { return 1; }; oss_refuse_unsafe() { echo "oss: refusing unsafe .oss path ${1:-} (oss-safe-path.sh missing)" >&2; }; fi
if ! oss_safe_mkdir "$WORKTREE_PATH" .oss; then
    oss_refuse_unsafe .oss
    exit 0
fi

# Copy auth config from home directory (shared credentials)
if [[ -f "$HOME/.oss/config.json" ]] && (cd "$WORKTREE_PATH" && git ls-files --error-unmatch .oss/config.json >/dev/null 2>&1); then
    echo "oss: .oss/config.json is tracked by git; not copying the API key into it" >&2
elif [[ -f "$HOME/.oss/config.json" ]] && ! oss_safe_target "$WORKTREE_PATH" .oss/config.json; then
    oss_refuse_unsafe .oss/config.json
elif [[ -f "$HOME/.oss/config.json" ]]; then
    cp "$HOME/.oss/config.json" "$WORKTREE_PATH/.oss/config.json"
    chmod 600 "$WORKTREE_PATH/.oss/config.json"
fi

# Initialize workflow-state.json with defaults
if ! oss_safe_target "$WORKTREE_PATH" .oss/workflow-state.json; then
    oss_refuse_unsafe .oss/workflow-state.json
    exit 0
fi
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
