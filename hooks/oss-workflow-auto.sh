#!/bin/bash
# OSS Dev Workflow - Automatic Workflow State Updates
#
# Called by Claude Code hooks on PreToolCall and PostToolCall
# to automatically track which /oss:* command is running.
#
# Usage:
#   oss-workflow-auto.sh pre <command> [project-dir]   # Called before command starts
#   oss-workflow-auto.sh post <command> [project-dir]  # Called after command completes
#
# Updates workflow-state.json with:
#   - currentCommand: The command currently running (set on pre, cleared on post)
#   - nextCommand: The next recommended command (set on post based on workflow)
#   - supervisor: Set to "watching" on pre

EVENT="$1"      # "pre" or "post"
COMMAND="$2"    # "ideate", "plan", "build", "ship", etc.
PROJECT_DIR="$3" # Optional: project directory for state file location

# Get the CLI path
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}"
CLI="${PLUGIN_ROOT}/watcher/dist/cli/update-workflow-state.js"

# Verify CLI exists
if [[ ! -f "$CLI" ]]; then
    echo "Warning: CLI not found at $CLI" >&2
    exit 0  # Don't fail hooks - graceful degradation
fi

# Build project dir flag if specified
PROJECT_FLAG=""
if [[ -n "$PROJECT_DIR" ]]; then
    PROJECT_FLAG="--project-dir $PROJECT_DIR"
fi

case "$EVENT" in
  pre)
    # Command is starting
    node "$CLI" $PROJECT_FLAG setCurrentCommand "$COMMAND" 2>/dev/null
    node "$CLI" $PROJECT_FLAG setSupervisor watching 2>/dev/null
    ;;

  post)
    # Command completed - derive next command from workflow progression
    case "$COMMAND" in
      ideate) NEXT="plan" ;;
      plan) NEXT="build" ;;
      build) NEXT="ship" ;;
      ship) NEXT="" ;;
      *) NEXT="" ;;  # Non-workflow commands don't affect nextCommand
    esac

    if [[ -n "$NEXT" ]]; then
      node "$CLI" $PROJECT_FLAG setNextCommand "$NEXT" 2>/dev/null
    else
      node "$CLI" $PROJECT_FLAG clearNextCommand 2>/dev/null
    fi

    # Clear currentCommand since command is done
    node "$CLI" $PROJECT_FLAG clearCurrentCommand 2>/dev/null
    ;;

  *)
    echo "Usage: oss-workflow-auto.sh <pre|post> <command> [project-dir]" >&2
    exit 1
    ;;
esac
