# Plan: IRON LAW PRE-CHECK Log Persistence + Archive Fix

## Problem Statement

**Problem 1: IRON LAW logs not persisted**
The IRON LAW PRE-CHECK hook (`oss-iron-law-check.sh`) outputs compliance status to stdout (shown via system-reminder), but this data is **not persisted** to the workflow logs. The supervisor and unified session log have no record of IRON LAW checks.

**Problem 2: Phase 0 archive detection too strict**
The archive detection in `/oss:plan` Phase 0 requires BOTH `"Current Phase: ship"` AND `"shipped|merged|complete"`. But features can be marked complete in other ways:
- `## Current Phase: build (COMPLETE)`
- `## Current Phase: completed`
- `## Current Phase: complete`

This causes completed features to pile up in `dev/active/` instead of being archived.

**Current State:**
- Hook outputs to stdout only
- Session log (`~/.oss/logs/current-session/session.log`) has no IRON LAW entries
- Command logs have no IRON LAW entries
- `iron-law-state.json` tracks violations but not check history
- Completed features not being archived (12+ in dev/active/)

**Desired State:**
- Every PRE-CHECK result persisted to session log
- Every PRE-CHECK result persisted to command log (when command running)
- Structured format for supervisor parsing
- Human-readable format for debugging
- Completed features auto-archived by `/oss:ship`

## Phase 0: Fix Archive Detection Logic

**Goal:** Update archive detection to catch all completion patterns

### Task 0.1: RED - Test archive detection patterns
```bash
# Create test PROGRESS.md files with various completion patterns
# Verify detection script catches them all
```
**Acceptance Criteria:**
- Detects `Current Phase: ship` with merged/complete
- Detects `Current Phase: build (COMPLETE)`
- Detects `Current Phase: completed`
- Detects `Current Phase: complete`

### Task 0.2: GREEN - Update API prompt archive logic
Update the Phase 0 logic in `packages/api/src/prompts/plan.ts` to use broader detection:
```bash
# Check for ANY of these completion indicators:
# 1. Phase contains "complete" (case insensitive)
# 2. Phase is "ship" AND contains shipped/merged
# 3. All tasks checked off [x]
```

### Task 0.3: REFACTOR - Add archive helper script
Create `hooks/oss-archive-check.sh` that can be called by any command:
```bash
#!/bin/bash
# Check dev/active/ for completed features and archive them
# Called by: /oss:plan, /oss:ship
```

## Phase 1: Add `ironlaw` Action to oss-log.sh

**Goal:** Add new log action for IRON LAW check results

### Task 1.1: RED - Test `ironlaw` action exists
```bash
# Test: oss-log.sh ironlaw should accept arguments
./hooks/oss-log.sh ironlaw plan "PASSED" ""
# Should not error
```
**Acceptance Criteria:**
- `ironlaw` action accepts: command, status, violations

### Task 1.2: GREEN - Implement `ironlaw` action
Add to `oss-log.sh`:
```bash
ironlaw)
    # Log IRON LAW check result
    COMMAND="$2"
    STATUS="$3"       # PASSED or FAILED
    VIOLATIONS="$4"   # JSON array of violations
    log_entry "$COMMAND" "IRON_LAW" "$STATUS $VIOLATIONS"
    ;;
```

### Task 1.3: REFACTOR - Format for supervisor parsing
Output format:
```
[HH:MM:SS] [command] [IRON_LAW] PASSED
[HH:MM:SS] [command] [IRON_LAW] FAILED violations=[4,1]
```

## Phase 2: Update oss-iron-law-check.sh to Persist Results

**Goal:** Hook writes results to log in addition to stdout

### Task 2.1: RED - Test log entry created on check
```bash
# Run the hook, then verify log entry exists
./hooks/oss-iron-law-check.sh
grep "IRON_LAW" ~/.oss/logs/current-session/session.log
# Should find entry
```
**Acceptance Criteria:**
- Hook creates log entry with check results

### Task 2.2: GREEN - Add logging call to hook
At end of `oss-iron-law-check.sh`:
```bash
# Determine current command from environment or default to "precheck"
CURRENT_CMD="${OSS_CURRENT_COMMAND:-precheck}"

# Log the result
if [[ -n "$VIOLATIONS" ]]; then
    "${CLAUDE_PLUGIN_ROOT}/hooks/oss-log.sh" ironlaw "$CURRENT_CMD" "FAILED" "$VIOLATION_LAWS"
else
    "${CLAUDE_PLUGIN_ROOT}/hooks/oss-log.sh" ironlaw "$CURRENT_CMD" "PASSED" ""
fi
```

### Task 2.3: REFACTOR - Track which laws were checked/violated
Collect law numbers for structured logging:
```bash
VIOLATION_LAWS=""   # e.g., "4,1,2"
PASSED_LAWS=""      # e.g., "1,2"
```

## Phase 3: Add Completion Checklist to Commands

**Goal:** Each command logs IRON LAW compliance checklist on completion

### Task 3.1: RED - Test checklist logged on build complete
```bash
# After running /oss:build, check log for checklist
grep "IRON LAW COMPLIANCE" ~/.oss/logs/current-session/build.log
```
**Acceptance Criteria:**
- Build command logs compliance checklist on completion

### Task 3.2: GREEN - Add checklist logging to command wrappers
In `commands/build.md` completion section:
```bash
# Log IRON LAW compliance checklist
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh write build "# IRON LAW COMPLIANCE:"
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh write build "#   [✓] LAW #1: TDD - Tests written first"
# ... etc
```

### Task 3.3: REFACTOR - Create helper for checklist generation
Add to `oss-log.sh`:
```bash
checklist)
    COMMAND="$2"
    # Generate and log compliance checklist
    ;;
```

## Phase 4: Integration Testing

### Task 4.1: Verify session log has IRON LAW entries
```bash
# Run a command, check session log
/oss:build
cat ~/.oss/logs/current-session/session.log | grep -i "iron\|law"
```

### Task 4.2: Verify command log has IRON LAW entries
```bash
cat ~/.oss/logs/current-session/build.log | grep -i "iron\|law"
```

### Task 4.3: Verify supervisor can parse entries
Check that `IronLawLogParser` can parse the new log format.

## Task Summary

| # | Task | Phase | Test Type |
|---|------|-------|-----------|
| 0.1 | Test archive detection patterns | 0 | Unit |
| 0.2 | Update API prompt archive logic | 0 | Unit |
| 0.3 | Add archive helper script | 0 | Unit |
| 1.1 | Test `ironlaw` action exists | 1 | Unit |
| 1.2 | Implement `ironlaw` action | 1 | Unit |
| 1.3 | Format for supervisor | 1 | Unit |
| 2.1 | Test log entry on check | 2 | Integration |
| 2.2 | Add logging to hook | 2 | Integration |
| 2.3 | Track law numbers | 2 | Unit |
| 3.1 | Test checklist on complete | 3 | Integration |
| 3.2 | Add checklist to wrappers | 3 | Integration |
| 3.3 | Create checklist helper | 3 | Unit |
| 4.1 | Verify session log | 4 | E2E |
| 4.2 | Verify command log | 4 | E2E |
| 4.3 | Verify parser works | 4 | Integration |

## Dependencies

- `oss-log.sh` (to be modified)
- `oss-iron-law-check.sh` (to be modified)
- `packages/api/src/prompts/plan.ts` (to be modified - archive logic)
- Command wrapper files (`commands/*.md`)
- `IronLawLogParser` (existing, verify compatibility)
- NEW: `hooks/oss-archive-check.sh` (to be created)

## Success Criteria

1. Every IRON LAW PRE-CHECK appears in session.log
2. Completion checklist appears in command logs
3. Supervisor can parse and track IRON LAW compliance
4. All existing tests pass (543/543)
5. New tests added for logging functionality
6. Completed features auto-archived when running `/oss:ship`
7. Archive detects all completion patterns (COMPLETE, completed, complete, shipped, merged)

## Command Chain

```
/oss:plan (this) → /oss:build → /oss:ship
```

---

*Created: 2025-12-09*
*Status: Ready for /oss:build*
