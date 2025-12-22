# Progress: Statusbar Refactor

## Current Phase: ship

## Tasks

### Phase 1: Bug Fix
- [x] Task 1.1: Fix "Saved unknown" notification message (completed 2025-12-22)

### Phase 2: State Consolidation
- [x] Task 2.1: Add queueSummary field to workflow-state.json (completed 2025-12-22)
- [x] Task 2.2: Add health field to workflow-state.json (completed 2025-12-22)

### Phase 3: Statusline Rewrite
- [x] Task 3.1: Rewrite compute_workflow() with clear priority (completed 2025-12-22)
- [x] Task 3.2: Simplify section ordering in build_status_line() (completed 2025-12-22)
- [x] Task 3.3: Read consolidated state (single JSON read) (completed 2025-12-22)

### Phase 4: Notification Polish
- [x] Task 4.1: Fix notification-copy.ts saveDate fallback (completed 2025-12-22)
- [x] Task 4.2: Fix session-start.sh date parsing robustness (completed 2025-12-22)

### Phase 5: Idle State
- [x] Task 5.1: Implement minimal idle state display (completed 2025-12-22)

### Ship
- [x] Run all tests (843 passing)
- [ ] Verify performance (<100ms render)
- [ ] Create PR

## Completed Work Summary

### Bug Fixes
1. **Fixed "Saved unknown" notification** - `notification-copy.ts` now returns "Context restored" when date parsing fails
2. **Fixed session-start.sh date handling** - Initializes `SAVE_DATE=""` instead of "unknown" for graceful fallback

### State Consolidation
3. **Added QueueSummary interface** - `{ pendingCount, criticalCount, topTask? }` to WorkflowState
4. **Added HealthStatus interface** - `{ status: 'healthy'|'violation', violatedLaw? }` to WorkflowState
5. **Added setQueueSummary/clearQueueSummary methods** - For consolidated queue state
6. **Added setHealth/clearHealth methods** - For consolidated health state

### Renderer Rewrite
7. **Separated compute_agent()** - Agent display now independent from workflow
8. **Improved compute_workflow() priority** - Clear documentation of priority order
9. **Updated compute_health()** - Reads from consolidated state first, falls back to iron-law-state.json
10. **Updated compute_queue()** - Reads from consolidated state first, falls back to queue.json
11. **Updated build_status_line()** - Clear section ordering with agent section

### Display Improvements
12. **Implemented minimal idle state** - When no active workflow: shows only `health | branch | → next`
13. **Updated test expectations** - All statusline tests match new behavior

## Test Results
- 843 tests passing (100%)
- All statusline tests updated for new behavior

## Blockers
- None

## Last Updated: 2025-12-22 12:25 by /oss:build
