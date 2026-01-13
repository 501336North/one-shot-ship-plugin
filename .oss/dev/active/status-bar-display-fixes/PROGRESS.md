# Progress: Status Bar Display Fixes

## Current Phase: plan

## Tasks

### Phase 1: Fix Status Line Display (oss-statusline.sh)
- [ ] Task 1.1: Always show model/project info (remove idle-state conditional)

### Phase 2: Fix Workflow State Management (workflow-state.ts)
- [ ] Task 2.1: Set currentCommand on setActiveStep
- [ ] Task 2.2: Clear currentCommand on completeStep

### Phase 3: Display Logic (oss-statusline.sh)
- [ ] Task 3.1: Handle "DONE" state after ship completes

### Phase 4: Tests
- [ ] Task 4.1: Add unit tests for currentCommand behavior
- [ ] Task 4.2: Add integration tests for status line output

## Blockers
- None

## Last Updated: 2025-12-24 10:15 by plan command
