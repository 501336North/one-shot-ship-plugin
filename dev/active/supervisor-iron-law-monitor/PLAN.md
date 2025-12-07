# Plan: Supervisor IRON LAW Monitor

## Overview
Add IronLawMonitor service to WatcherSupervisor that continuously monitors for IRON LAW violations, not just workflow log entries.

## Phase 1: IronLawMonitor Service (RED → GREEN → REFACTOR)

### Task 1.1: Write IronLawMonitor Tests (RED)
- Test git branch detection (main/master = violation)
- Test file change detection (new .ts without .test.ts)
- Test state file management (~/.oss/iron-law-state.json)
- Test violation detection and resolution tracking

### Task 1.2: Implement IronLawMonitor (GREEN)
- Create IronLawMonitor class
- Implement `checkGitBranch()` - IRON LAW #4
- Implement `checkTestCoverage()` - IRON LAW #1
- Implement `checkDevDocs()` - IRON LAW #6
- State management for violations

### Task 1.3: Refactor IronLawMonitor
- Clean up implementation
- Optimize git/fs operations
- Add proper error handling

## Phase 2: Settings Integration

### Task 2.1: Write Settings Tests (RED)
- Test loading supervisor.mode setting
- Test default value ("always")
- Test "workflow-only" mode

### Task 2.2: Implement Settings (GREEN)
- Update SettingsService to handle supervisor config
- Add mode: "always" | "workflow-only"
- Add ironLawChecks toggle config

### Task 2.3: Refactor Settings
- Clean up, ensure backwards compatibility

## Phase 3: WatcherSupervisor Integration

### Task 3.1: Write Integration Tests (RED)
- Test supervisor calls IronLawMonitor
- Test interventions generated for violations
- Test queue receives corrective actions

### Task 3.2: Implement Integration (GREEN)
- Add IronLawMonitor to WatcherSupervisor
- Call monitor on interval (default 5s)
- Generate interventions for violations

### Task 3.3: Refactor Integration
- Optimize check frequency
- Debounce rapid changes

## Phase 4: Notifications

### Task 4.1: Update oss-notify.sh
- Add --iron-law mode for violation notifications
- Show in SwiftBar when violations detected

## Phase 5: Ship

### Task 5.1: Quality Checks
- All tests passing
- Manual testing

### Task 5.2: Create PR
- Commit and push
- Create PR with summary

## Dependencies
- Existing WatcherSupervisor
- SettingsService
- MenuBarService (for state updates)
- oss-notify.sh

## Acceptance Criteria
- [ ] IronLawMonitor detects main branch usage
- [ ] IronLawMonitor detects code without tests
- [ ] IronLawMonitor detects stale dev docs
- [ ] Settings allow "always" vs "workflow-only" mode
- [ ] Default is "always" monitoring
- [ ] Violations trigger notifications
- [ ] Violations queue corrective actions
- [ ] All tests passing
