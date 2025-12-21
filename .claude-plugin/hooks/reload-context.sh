#!/bin/bash
#
# OSS Plugin - Reload Context on SessionStart
#
# Loads saved context from previous sessions for seamless continuation.
#

set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

CONTEXT_DIR="$HOME/.claude/plugins/data/oss-context"
PROJECT_HASH=$(echo "$PROJECT_DIR" | md5 | cut -c1-8)
CONTEXT_FILE="$CONTEXT_DIR/session-$PROJECT_HASH.json"

if [ -f "$CONTEXT_FILE" ]; then
  SAVED_AT=$(jq -r '.saved_at // "unknown"' "$CONTEXT_FILE")
  TRIGGER=$(jq -r '.trigger // "unknown"' "$CONTEXT_FILE")
  GIT_BRANCH=$(jq -r '.project.git_branch // "unknown"' "$CONTEXT_FILE")

  # Calculate age
  if [ "$(uname)" == "Darwin" ]; then
    SAVED_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$SAVED_AT" "+%s" 2>/dev/null || echo "0")
  else
    SAVED_EPOCH=$(date -d "$SAVED_AT" "+%s" 2>/dev/null || echo "0")
  fi
  NOW_EPOCH=$(date "+%s")
  AGE_HOURS=$(( (NOW_EPOCH - SAVED_EPOCH) / 3600 ))

  echo "## OSS Plugin - Previous Session Context"
  echo ""
  echo "**Last session:** $SAVED_AT (${AGE_HOURS}h ago)"
  echo "**Branch:** $GIT_BRANCH"
  echo ""

  # Show todos if any
  TODOS=$(jq -r '.session.todos // []' "$CONTEXT_FILE")
  if [ "$TODOS" != "[]" ] && [ "$TODOS" != "null" ]; then
    echo "**Pending Tasks:**"
    echo "$TODOS" | jq -r 'map(select(.status != "completed")) | .[0:5] | map("- " + .content) | .[]' 2>/dev/null || true
    echo ""
  fi

  # Show recent tool activity
  TOOL_SUMMARY=$(jq -r '.session.recent_tool_uses // []' "$CONTEXT_FILE" | jq -r '
    group_by(.name) |
    map({name: .[0].name, count: length}) |
    sort_by(-.count) |
    .[0:5] |
    map("\(.name) (\(.count)x)") |
    join(", ")
  ' 2>/dev/null)

  if [ -n "$TOOL_SUMMARY" ] && [ "$TOOL_SUMMARY" != "" ]; then
    echo "**Recent Activity:** $TOOL_SUMMARY"
    echo ""
  fi

  if [ "$AGE_HOURS" -gt 24 ]; then
    echo "**Note:** Context is ${AGE_HOURS}h old - may be outdated"
    echo ""
  fi

  echo "---"
fi

# Check for dev docs with project-local priority
# Priority: 1) ./.oss/dev/active/, 2) ./dev/active/, 3) ~/.oss/dev/active/
PROJECT_DIR=$(pwd)
DEV_DOCS_DIR=""
DEV_DOCS_DISPLAY=""

if [ -d "$PROJECT_DIR/.oss/dev/active" ] && [ -n "$(ls -A "$PROJECT_DIR/.oss/dev/active" 2>/dev/null)" ]; then
  DEV_DOCS_DIR="$PROJECT_DIR/.oss/dev/active"
  DEV_DOCS_DISPLAY=".oss/dev/active"
elif [ -d "$PROJECT_DIR/dev/active" ] && [ -n "$(ls -A "$PROJECT_DIR/dev/active" 2>/dev/null)" ]; then
  DEV_DOCS_DIR="$PROJECT_DIR/dev/active"
  DEV_DOCS_DISPLAY="dev/active"
elif [ -d "$HOME/.oss/dev/active" ] && [ -n "$(ls -A "$HOME/.oss/dev/active" 2>/dev/null)" ]; then
  DEV_DOCS_DIR="$HOME/.oss/dev/active"
  DEV_DOCS_DISPLAY="~/.oss/dev/active"
fi

if [ -n "$DEV_DOCS_DIR" ]; then
  echo ""
  echo "## Active Development Features"
  for FEATURE_DIR in "$DEV_DOCS_DIR"/*; do
    if [ -d "$FEATURE_DIR" ]; then
      FEATURE_NAME=$(basename "$FEATURE_DIR")
      echo "- **$FEATURE_NAME**: $DEV_DOCS_DISPLAY/$FEATURE_NAME/"
    fi
  done
  echo ""
  echo "Run \`/dev:resume-dev-docs\` to load feature context."
  echo "---"
fi

exit 0
