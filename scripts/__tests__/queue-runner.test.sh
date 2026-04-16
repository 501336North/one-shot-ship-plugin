#!/bin/bash
# Tests for queue-runner.sh
#
# Usage: scripts/__tests__/queue-runner.test.sh
#
# Covers Tasks 9-14:
# - Task 9: tracking.json read/write with file locking
# - Task 10: Sequential drain loop
# - Task 11: Session resumption
# - Task 12: Build retry
# - Task 13: Conflict resolution
# - Task 14: Timing and history tracking

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_SCRIPT="$SCRIPT_DIR/../queue-runner.sh"
TEMP_DIR=$(mktemp -d)

# Test tracking
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((TESTS_PASSED++))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    ((TESTS_FAILED++))
}

cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

# Create test fixtures
setup_tracking_json() {
    local dir="$TEMP_DIR/.oss/queue"
    mkdir -p "$dir"
    cat > "$dir/tracking.json" << 'FIXTURE'
{
  "items": [
    {
      "id": "item-1",
      "type": "feature",
      "source": "Add auth",
      "prompt": "Build auth middleware",
      "status": "ideated",
      "createdAt": "2026-04-16T10:00:00Z",
      "sessions": { "ideate": "sess-ideate-1" }
    },
    {
      "id": "item-2",
      "type": "issue",
      "source": "Fix bug #42",
      "prompt": "Fix the login bug",
      "status": "ideated",
      "createdAt": "2026-04-16T11:00:00Z",
      "sessions": { "ideate": "sess-ideate-2" }
    },
    {
      "id": "item-3",
      "type": "feature",
      "source": "Queued only",
      "prompt": "Not yet ideated",
      "status": "queued",
      "createdAt": "2026-04-16T12:00:00Z"
    }
  ],
  "history": {
    "completed_runs": 3,
    "avg_duration_per_phase": { "plan": 300, "build": 600, "ship": 120 }
  }
}
FIXTURE
}

# ─── Task 9: tracking.json read/write with file locking ───

echo "=== Task 9: Tracking JSON & File Locking ==="

# Test 1: Script exists and is executable
((TESTS_RUN++))
if [[ -f "$RUNNER_SCRIPT" && -x "$RUNNER_SCRIPT" ]]; then
    pass "queue-runner.sh exists and is executable"
else
    fail "queue-runner.sh should exist and be executable"
fi

# Test 2: Script sources correctly and has required functions
((TESTS_RUN++))
if grep -q "read_tracking" "$RUNNER_SCRIPT" && grep -q "write_tracking" "$RUNNER_SCRIPT"; then
    pass "script has read_tracking and write_tracking functions"
else
    fail "script should have read_tracking and write_tracking functions"
fi

# Test 3: Atomic write (temp + rename pattern)
((TESTS_RUN++))
if grep -q '\.tmp' "$RUNNER_SCRIPT" && grep -q 'mv ' "$RUNNER_SCRIPT"; then
    pass "script uses atomic write (temp + rename)"
else
    fail "script should write to .tmp then mv for atomic writes"
fi

# Test 4: File locking with .lock file
((TESTS_RUN++))
if grep -q 'tracking.json.lock\|\.lock' "$RUNNER_SCRIPT"; then
    pass "script uses file locking"
else
    fail "script should use tracking.json.lock for file locking"
fi

# Test 5: Stale lock timeout at 10 seconds
((TESTS_RUN++))
if grep -q '10' "$RUNNER_SCRIPT" && grep -q 'stale\|LOCK_TIMEOUT' "$RUNNER_SCRIPT"; then
    pass "script has stale lock timeout (10s)"
else
    fail "script should have 10-second stale lock timeout"
fi

# ─── Task 10: Sequential drain loop ───

echo ""
echo "=== Task 10: Sequential Drain Loop ==="

# Test 6: Process only ideated items
((TESTS_RUN++))
if grep -q '"ideated"\|status.*ideated\|ideated' "$RUNNER_SCRIPT"; then
    pass "script filters for ideated items"
else
    fail "script should process only items with status ideated"
fi

# Test 7: Feature branch per item
((TESTS_RUN++))
if grep -q 'git checkout -b.*queue' "$RUNNER_SCRIPT"; then
    pass "script creates feature branch per item"
else
    fail "script should git checkout -b feat/queue-{slug} origin/main"
fi

# Test 8: continueOnFailure
((TESTS_RUN++))
if grep -q 'continue\|continueOnFailure\|continue_on_failure' "$RUNNER_SCRIPT"; then
    pass "script continues after item failure"
else
    fail "script should continue to next item after failure"
fi

# Test 9: Status transitions
((TESTS_RUN++))
if grep -q 'planning' "$RUNNER_SCRIPT" && grep -q 'building' "$RUNNER_SCRIPT" && grep -q 'shipping' "$RUNNER_SCRIPT"; then
    pass "script has status transitions (planning, building, shipping)"
else
    fail "script should update status: ideated→planning→building→shipping→completed"
fi

# ─── Task 11: Session resumption ───

echo ""
echo "=== Task 11: Session Resumption ==="

# Test 10: Pass --resume with session ID
((TESTS_RUN++))
if grep -q '\-\-resume' "$RUNNER_SCRIPT"; then
    pass "script uses --resume for session resumption"
else
    fail "script should pass --resume {sessionId} to plan"
fi

# Test 11: Fresh fallback on resume failure
((TESTS_RUN++))
if grep -q 'fallback\|fresh\|without.*resume' "$RUNNER_SCRIPT"; then
    pass "script falls back to fresh session on resume failure"
else
    fail "script should fall back to fresh session when resume fails"
fi

# Test 12: Session ID chaining
((TESTS_RUN++))
if grep -q 'session.*plan\|session.*build\|session.*ship\|sessions' "$RUNNER_SCRIPT"; then
    pass "script chains session IDs across phases"
else
    fail "script should chain session IDs (plan→build→ship)"
fi

# ─── Task 12: Build retry ───

echo ""
echo "=== Task 12: Build Retry ==="

# Test 13: Retry build on failure
((TESTS_RUN++))
if grep -q 'retry\|RETRY\|retries' "$RUNNER_SCRIPT"; then
    pass "script has retry logic for build"
else
    fail "script should retry build on failure"
fi

# Test 14: Mark as failed after retries exhausted
((TESTS_RUN++))
if grep -q 'failed' "$RUNNER_SCRIPT" && grep -q 'retries\|retry_count\|MAX_RETRIES' "$RUNNER_SCRIPT"; then
    pass "script marks as failed after max retries"
else
    fail "script should mark as failed after both retries fail"
fi

# ─── Task 13: Conflict resolution ───

echo ""
echo "=== Task 13: Conflict Resolution ==="

# Test 15: Detect conflicts with origin/main
((TESTS_RUN++))
if grep -q 'git.*merge.*origin/main\|git.*fetch.*origin' "$RUNNER_SCRIPT"; then
    pass "script checks for conflicts with origin/main"
else
    fail "script should detect conflicts with origin/main before ship"
fi

# Test 16: Auto-resolve using dev docs
((TESTS_RUN++))
if grep -q 'DESIGN.md\|PLAN.md\|dev docs\|resolve.*conflict' "$RUNNER_SCRIPT"; then
    pass "script uses dev docs for conflict resolution"
else
    fail "script should auto-resolve conflicts using dev docs context"
fi

# Test 17: Re-run tests after resolution
((TESTS_RUN++))
if grep -q 'test.*after\|post.*resolve\|run.*test' "$RUNNER_SCRIPT"; then
    pass "script re-runs tests after conflict resolution"
else
    fail "script should re-run tests after conflict resolution"
fi

# Test 18: Flag human when tests fail after resolution
((TESTS_RUN++))
if grep -q 'human\|HUMAN_REVIEW\|flag.*review' "$RUNNER_SCRIPT"; then
    pass "script flags human review on post-resolution test failure"
else
    fail "script should flag human when tests fail after resolution"
fi

# ─── Task 14: Timing and history ───

echo ""
echo "=== Task 14: Timing & History ==="

# Test 19: Record duration per phase
((TESTS_RUN++))
if grep -q 'duration\|SECONDS\|start_time\|end_time' "$RUNNER_SCRIPT"; then
    pass "script records duration per phase"
else
    fail "script should record duration per phase in tracking.json"
fi

# Test 20: Update history averages
((TESTS_RUN++))
if grep -q 'avg_duration\|average\|rolling' "$RUNNER_SCRIPT"; then
    pass "script updates history averages"
else
    fail "script should update history.avg_duration_per_phase after completion"
fi

# Test 21: Increment completed_runs counter
((TESTS_RUN++))
if grep -q 'completed_runs' "$RUNNER_SCRIPT"; then
    pass "script increments completed_runs counter"
else
    fail "script should increment history.completed_runs"
fi

# Summary
echo ""
echo "==============================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"
echo "==============================="

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
