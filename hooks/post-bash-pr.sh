#!/bin/bash
# post-bash-pr.sh - PR enhancement after gh pr create
# Part of OSS Dev Workflow - PostToolUse hook
#
# Runs after Bash tool completes
# Detects PR creation and shows quick-action commands

set -e

# Get the command output from Claude tool output
TOOL_OUTPUT="${CLAUDE_TOOL_OUTPUT:-}"

# If no output, try standard input
if [[ -z "$TOOL_OUTPUT" ]]; then
    TOOL_OUTPUT=$(cat 2>/dev/null || echo "")
fi

# Exit silently if no output
if [[ -z "$TOOL_OUTPUT" ]]; then
    exit 0
fi

# Detect GitHub PR URL in output
# Pattern: https://github.com/{owner}/{repo}/pull/{number}
PR_URL=$(echo "$TOOL_OUTPUT" | grep -oE 'https://github\.com/[^/]+/[^/]+/pull/[0-9]+' | head -1 || echo "")

if [[ -z "$PR_URL" ]]; then
    exit 0
fi

# Extract PR number from URL
PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$' || echo "")

if [[ -z "$PR_NUMBER" ]]; then
    exit 0
fi

# Extract repo info
REPO_PATH=$(echo "$PR_URL" | sed -E 's|https://github.com/([^/]+/[^/]+)/pull/[0-9]+|\1|')

# Display PR enhancement
echo "
✅ PR #${PR_NUMBER} created: ${PR_URL}

Quick Actions:
  gh pr view ${PR_NUMBER} --web      # Open in browser
  gh pr checks ${PR_NUMBER}          # View CI status
  gh pr merge ${PR_NUMBER} --squash  # Merge when ready

Review Checklist:
  □ CI passing
  □ Code reviewed
  □ No merge conflicts
"

exit 0
