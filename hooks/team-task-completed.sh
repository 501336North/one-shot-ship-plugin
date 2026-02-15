#!/bin/bash
# OSS Agent Teams - Task Completed Quality Gate
# Triggered on: TaskCompleted (when an agent marks a task as done)
# Validates that tests pass before allowing task completion.
#
# Exit codes:
#   0 = Allow task completion
#   2 = Block task completion (feedback sent to agent)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_SCRIPT="$SCRIPT_DIR/oss-log.sh"

# --- Hook Logging ---
if [[ -x "$LOG_SCRIPT" ]]; then
    "$LOG_SCRIPT" hook team-task-completed START
fi

# Read task metadata from stdin (Claude Code passes JSON)
TASK_INPUT=$(cat)

# Only run in git repositories
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if [[ -x "$LOG_SCRIPT" ]]; then
        "$LOG_SCRIPT" hook team-task-completed COMPLETE
    fi
    exit 0
fi

# Run tests to validate task completion
TEST_OUTPUT=$(npx vitest run --reporter=verbose 2>&1)
TEST_EXIT=$?

if [[ $TEST_EXIT -ne 0 ]]; then
    # Tests failed — block task completion
    if [[ -x "$LOG_SCRIPT" ]]; then
        "$LOG_SCRIPT" hook team-task-completed "BLOCKED: tests failing"
    fi
    echo "Task completion blocked: tests are failing. Fix failing tests before marking task as complete."
    echo ""
    echo "Test output (last 20 lines):"
    echo "$TEST_OUTPUT" | tail -20
    exit 2
fi

# Run lint check if package.json has lint script
if grep -q '"lint"' package.json 2>/dev/null; then
    LINT_OUTPUT=$(npm run lint 2>&1)
    LINT_EXIT=$?

    if [[ $LINT_EXIT -ne 0 ]]; then
        if [[ -x "$LOG_SCRIPT" ]]; then
            "$LOG_SCRIPT" hook team-task-completed "BLOCKED: lint failing"
        fi
        echo "Task completion blocked: lint check failing. Fix lint issues before marking task as complete."
        echo ""
        echo "Lint output (last 10 lines):"
        echo "$LINT_OUTPUT" | tail -10
        exit 2
    fi
fi

# All checks passed
if [[ -x "$LOG_SCRIPT" ]]; then
    "$LOG_SCRIPT" hook team-task-completed COMPLETE
fi
exit 0
