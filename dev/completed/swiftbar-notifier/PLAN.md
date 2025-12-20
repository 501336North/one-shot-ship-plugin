# Plan: SwiftBar + Jamf Notifier Integration

## Phase 1: MenuBarService (Core State Management)

### Task 1.1: Write MenuBarService Tests (RED)
- [ ] Test state file initialization
- [ ] Test reading existing state
- [ ] Test corrupted file handling
- [ ] Test setActiveStep with chain progression
- [ ] Test setTddPhase for build sub-phases
- [ ] Test setSupervisor status
- [ ] Test setProgress tracking
- [ ] Test lastUpdate timestamp

### Task 1.2: Implement MenuBarService (GREEN)
- [ ] Delegate to typescript-pro agent
- [ ] Implement all methods per test expectations
- [ ] Ensure all tests pass

### Task 1.3: Refactor MenuBarService
- [ ] Clean up code
- [ ] Ensure type safety

## Phase 2: SwiftBar Plugin

### Task 2.1: Write SwiftBar Plugin Tests (RED)
- [ ] Test output format for menu bar
- [ ] Test chain visualization
- [ ] Test supervisor indicators
- [ ] Test dropdown menu structure

### Task 2.2: Implement SwiftBar Plugin (GREEN)
- [ ] Shell script that reads state file
- [ ] Outputs SwiftBar-compatible format
- [ ] Icon/text based on status

### Task 2.3: Create Plugin Installer
- [ ] Copy script to SwiftBar plugins folder
- [ ] Handle first-time setup

## Phase 3: Jamf Notifier Integration

### Task 3.1: Write Notifier Integration Tests (RED)
- [ ] Test notifier availability check
- [ ] Test banner notification
- [ ] Test alert notification
- [ ] Test fallback to terminal-notifier

### Task 3.2: Update oss-notify.sh (GREEN)
- [ ] Check for Notifier.app
- [ ] Use Jamf Notifier when available
- [ ] Fall back to terminal-notifier

## Phase 4: Login Command Updates

### Task 4.1: Update /oss:login (Installation)
- [ ] Check for SwiftBar installation
- [ ] Prompt to install if missing
- [ ] Download/install Jamf Notifier
- [ ] Copy SwiftBar plugin
- [ ] Initialize state file

## Phase 5: Integration

### Task 5.1: Update Notification Hooks
- [ ] Update oss-notify.sh to update state file
- [ ] Test menu bar updates on notifications

### Task 5.2: End-to-End Testing
- [ ] Test full workflow display
- [ ] Test supervisor indicators
- [ ] Test notifications

## Phase 6: Ship

### Task 6.1: Quality Checks
- [ ] All tests passing
- [ ] No TypeScript errors
- [ ] Documentation updated

### Task 6.2: Create PR
- [ ] Commit all changes
- [ ] Open PR with description
- [ ] Wait for review
