# Plan: SwiftBar Health Check Status Not Updating

## Problem Statement

When running health check from SwiftBar menu ("Run Health Check Now"), the SwiftBar icon shows a warning (⚠️) even after the health check passes. This is because:

1. The `oss-log.sh health-check` command runs the health check CLI
2. Output goes to terminal only (not saved to log file)
3. SwiftBar reads `~/.oss/logs/current-session/health-check.log` to determine icon
4. Without PASSED/FAILED in the log file, SwiftBar shows ⚠️ (unknown state)

## Root Cause

`oss-log.sh health-check` runs `node "$HEALTH_CHECK_CLI" --verbose` but doesn't redirect output to the log file that SwiftBar reads.

## Solution Design

Modify `oss-log.sh health-check` to:
1. Use `tee` to write output to both terminal AND log file
2. Preserve exit code from health check (not tee)
3. Confirm log file location to user

## TDD Implementation Plan

### Phase 1: Write Failing Tests (RED)

**Task 1.1: Test that health-check writes to log file**
- Location: `watcher/test/hooks/oss-log-health-check.test.ts`
- Behavior: Running `oss-log.sh health-check` should write output to `health-check.log`
- Expected: Log file contains health check output including PASSED/FAILED marker

**Task 1.2: Test that exit code is preserved**
- Behavior: Exit code from health check CLI should be returned, not tee's exit code
- Expected: Exit 0 for passing tests, Exit 1 for failing tests

**Task 1.3: Test SwiftBar reads updated log correctly**
- Behavior: After health check runs, SwiftBar script should show correct icon
- Expected: Green ✅ when PASSED, Red ❌ when FAILED

### Phase 2: Implement Solution (GREEN)

**Task 2.1: Update oss-log.sh health-check command**
- Add `tee` to capture output to log file
- Use `${PIPESTATUS[0]}` to preserve health check exit code
- Add confirmation message showing log path

### Phase 3: Verify Integration (REFACTOR)

**Task 3.1: Manual integration test**
- Run health check from SwiftBar menu
- Verify terminal shows output
- Verify log file is written
- Verify SwiftBar icon updates after refresh

## Acceptance Criteria

- [ ] Running health check from SwiftBar writes to `health-check.log`
- [ ] SwiftBar shows ✅ green when health check passes
- [ ] SwiftBar shows ❌ red when health check fails
- [ ] Exit codes are preserved for scripting
- [ ] Output still visible in terminal

## Files to Modify

1. `hooks/oss-log.sh` - Update health-check case to use tee
2. `watcher/test/hooks/oss-log-health-check.test.ts` - New test file (TDD)

## Notes

- The `refresh=true` in SwiftBar menu already triggers refresh after command
- No changes needed to SwiftBar script itself (detection logic is correct)
- Fix is isolated to `oss-log.sh` health-check command

## Status

- [x] Problem identified
- [x] Root cause analyzed
- [ ] Tests written (RED phase)
- [ ] Implementation complete (GREEN phase)
- [ ] Integration verified (REFACTOR phase)
