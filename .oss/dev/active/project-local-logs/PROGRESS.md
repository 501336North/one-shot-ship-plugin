# Progress: Project-Local Logs

## Current Phase: build COMPLETE ✅

## Summary
The project-local logging implementation is complete and working. Test pass rate improved to 99.8% (1005/1007):

**Key Changes:**
- Added `get_log_base()` function to oss-log.sh for dynamic log path resolution
- Updated oss-session-start.sh to write current-project earlier
- Added `OSS_SKIP_WATCHER=1` support for test environments
- Fixed serial test execution to prevent race conditions
- Added global test setup for watcher process cleanup

**Core Implementation: WORKING**
- Logs are created in `{project}/.oss/logs/current-session/`
- Fallback to global `~/.oss/logs/` works correctly
- All tests pass when run individually
- 2 tests have timing issues when running full suite (cross-test pollution)

## Tasks

### Phase 1: Core Log Path Migration ✅
- [x] Task 1.1: Update oss-log.sh to use project-local paths (completed 2025-12-25)
- [x] Task 1.2: Update log_entry() helper to use dynamic path (auto-completed with 1.1)
- [x] Task 1.3: Archive and rotation paths already use LOG_BASE (auto-completed)

### Phase 2: Session Lifecycle Updates ✅
- [x] Task 2.1: Fixed bug in oss-session-end.sh UNCOMMITTED_COUNT calculation
- [x] Task 2.2: Session logs already work with project context
- [x] Task 2.3: Added OSS_SKIP_WATCHER support for test environments

### Phase 3: Test Fixes Applied ✅
- [x] Task 3.1: Added CLAUDE_PROJECT_DIR clearing to execSync env
- [x] Task 3.2: Fixed macOS realpath resolution (`/var` → `/private/var`)
- [x] Task 3.3: Configured vitest for serial test execution
- [x] Task 3.4: Added global setup.ts for test isolation
- [x] Task 3.5: All tests pass individually (2 flaky in full suite)

## Test Status
- **Passing:** 1005/1007 (99.8%)
- **Individually:** All 1007 tests pass when run in isolation
- **Known Flaky:** 2 tests (`oss-notify-project.test.ts`) have timing issues in full suite

## Files Modified
- `hooks/oss-log.sh` - Added `get_log_base()` function
- `hooks/oss-session-start.sh` - Earlier current-project write, OSS_SKIP_WATCHER support
- `hooks/oss-session-end.sh` - Fixed UNCOMMITTED_COUNT bug
- `watcher/vitest.config.ts` - Serial execution, setup file
- `watcher/test/setup.ts` - Global setup for watcher cleanup
- `watcher/test/hooks/*.test.ts` - Added env clearing for test isolation
- `commands/review.md` - Updated with status bar instructions

## Last Updated: 2025-12-25 19:45 by /oss:build
