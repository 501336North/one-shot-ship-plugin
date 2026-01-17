# TDD Implementation Plan: Subcommand/Subagent Status Updates

## Overview

**Feature**: Update Claude Code status line when workflow commands run subcommands (red, green, refactor) or spawn subagents/tasks.

**Current State**:
- Status bar updates when `/oss:build`, `/oss:plan`, etc. run via `oss-notify.sh --workflow`
- `oss-notify.sh` updates `workflow-state.json` via `update-workflow-state.js`
- `oss-statusline.sh` reads `workflow-state.json` and displays TDD phase (RED/GREEN/REFACTOR)
- TDD phase commands (`red.md`, `green.md`, `refactor.md`) call `oss-notify.sh --workflow red start '{}'` etc.

**Gap**:
1. TDD phases set `activeStep` to "red"/"green"/"refactor" but the status line expects `tddPhase` field
2. No status updates when agents are spawned via Task tool
3. `oss-log.sh phase build RED start` logs the phase but doesn't update workflow state

## Architecture Decision

### Option A: Update workflow-state.json in oss-log.sh (Selected)

When `oss-log.sh phase build RED start` is called, also update `workflow-state.json` with `tddPhase: "red"`.

**Pros:**
- Commands already call `oss-log.sh phase build RED start` for logging
- Single point of truth for TDD phase tracking
- No changes needed to command wrappers

**Cons:**
- `oss-log.sh` becomes responsible for both logging AND state updates

### Option B: Update workflow-state.json in oss-notify.sh

Keep logging and state updates in `oss-notify.sh` with `task_complete` event.

**Rejected** - Commands don't call `oss-notify.sh` for phase transitions, only for start/complete.

### Option C: Add new hook for phase transitions

Create `oss-phase.sh` that handles both logging and state updates.

**Rejected** - Would require updating all command wrappers.

## Design

### 1. Extend oss-log.sh to Update Workflow State

When `oss-log.sh phase <command> <phase> start` is called:
- Write to log file (existing behavior)
- Also call `update-workflow-state.js setTddPhase <phase>`

When `oss-log.sh agent <command> <agent_type> <message>` is called:
- Write to log file (existing behavior)
- Parse message to determine if "starting" or "completed"
- If "starting": call `update-workflow-state.js setSupervisor intervening` + set `currentTask`
- If "completed": call `update-workflow-state.js setSupervisor watching` + clear `currentTask`

### 2. Extend workflow-state.json Schema

Add new fields to track active agent:
```json
{
  "activeAgent": {
    "type": "react-specialist",
    "task": "UserProfile component",
    "startedAt": "2025-12-21T14:30:00Z"
  },
  "tddPhase": "red" | "green" | "refactor" | null,
  "currentCommand": "build"
}
```

### 3. Extend oss-statusline.sh to Display Agent Status

When `activeAgent` is set, display:
```
[Claude] project | main | OSS ✅ | 🔴 RED | 🤖 react-specialist: UserProfile
```

## TDD Implementation Plan

### Phase 1: RED Phase Updates in oss-log.sh (3 tasks)

#### Task 1.1: Test oss-log.sh phase command updates tddPhase in workflow-state.json
**File**: `watcher/test/hooks/oss-log-phase-state.test.ts`
**Behavior**: When `oss-log.sh phase build RED start` is called, `tddPhase` in workflow-state.json should be set to "red"
**Acceptance Criteria**:
- AC-1.1.1: `oss-log.sh phase build RED start` sets `tddPhase: "red"`
- AC-1.1.2: `oss-log.sh phase build GREEN start` sets `tddPhase: "green"`
- AC-1.1.3: `oss-log.sh phase build REFACTOR start` sets `tddPhase: "refactor"`
- AC-1.1.4: Existing logging behavior is preserved

#### Task 1.2: Test oss-log.sh phase complete clears tddPhase for non-TDD phases
**File**: `watcher/test/hooks/oss-log-phase-state.test.ts`
**Behavior**: When `oss-log.sh phase plan RED complete` (non-build command), tddPhase should be cleared since the phase is complete
**Acceptance Criteria**:
- AC-1.2.1: `oss-log.sh phase build RED complete` keeps tddPhase (awaiting GREEN)
- AC-1.2.2: `oss-log.sh phase build REFACTOR complete` clears tddPhase (cycle done)

#### Task 1.3: Implement phase state updates in oss-log.sh
**File**: `hooks/oss-log.sh`
**Implementation**: Add `update-workflow-state.js setTddPhase` call in phase handler

### Phase 2: Agent Status Updates (4 tasks)

#### Task 2.1: Extend WorkflowState type with activeAgent field
**File**: `watcher/src/services/workflow-state.ts`
**Behavior**: Add `activeAgent` field to track currently executing agent
**Acceptance Criteria**:
- AC-2.1.1: `activeAgent` is optional object with `type`, `task`, `startedAt`
- AC-2.1.2: Type is one of the known agent types (e.g., "react-specialist")

#### Task 2.2: Add setActiveAgent method to WorkflowStateService
**File**: `watcher/src/services/workflow-state.ts`
**Behavior**: Method to set/clear the active agent
**Acceptance Criteria**:
- AC-2.2.1: `setActiveAgent({ type, task })` sets activeAgent with timestamp
- AC-2.2.2: `clearActiveAgent()` removes activeAgent field

#### Task 2.3: Add CLI commands for agent state
**File**: `watcher/src/cli/update-workflow-state.ts`
**Behavior**: CLI support for setting/clearing active agent
**Acceptance Criteria**:
- AC-2.3.1: `update-workflow-state.js setActiveAgent '{"type": "react-specialist", "task": "UserProfile"}'` works
- AC-2.3.2: `update-workflow-state.js clearActiveAgent` works

#### Task 2.4: Test oss-log.sh agent command updates workflow state
**File**: `watcher/test/hooks/oss-log-agent-state.test.ts`
**Behavior**: When `oss-log.sh agent build react-specialist "starting: UserProfile"` is called, activeAgent should be set
**Acceptance Criteria**:
- AC-2.4.1: `oss-log.sh agent build react-specialist "starting: task"` sets activeAgent
- AC-2.4.2: `oss-log.sh agent build react-specialist "completed: task"` clears activeAgent
- AC-2.4.3: Supervisor status is set to "intervening" when agent starts
- AC-2.4.4: Supervisor status is set to "watching" when agent completes

### Phase 3: Status Line Display (3 tasks)

#### Task 3.1: Test oss-statusline.sh displays tddPhase correctly
**File**: `watcher/test/hooks/oss-statusline.test.ts`
**Behavior**: Status line should show TDD phase when tddPhase is set in workflow-state.json
**Acceptance Criteria**:
- AC-3.1.1: Shows "🔴 RED" when tddPhase is "red"
- AC-3.1.2: Shows "🟢 GREEN" when tddPhase is "green"
- AC-3.1.3: Shows "🔵 REFACTOR" when tddPhase is "refactor"

#### Task 3.2: Test oss-statusline.sh displays activeAgent
**File**: `watcher/test/hooks/oss-statusline.test.ts`
**Behavior**: Status line should show active agent when set
**Acceptance Criteria**:
- AC-3.2.1: Shows "🤖 react-specialist: task" when activeAgent is set
- AC-3.2.2: Truncates long task names to prevent overflow

#### Task 3.3: Implement activeAgent display in oss-statusline.sh
**File**: `hooks/oss-statusline.sh`
**Implementation**: Read activeAgent from workflow-state.json and display

### Phase 4: Integration Testing (2 tasks)

#### Task 4.1: End-to-end test: build command TDD phases update status line
**File**: `watcher/test/integration/tdd-status-flow.test.ts`
**Behavior**: Simulates a full TDD cycle and verifies status line updates at each phase
**Acceptance Criteria**:
- AC-4.1.1: Phase transitions are reflected in workflow-state.json
- AC-4.1.2: oss-statusline.sh reads correct phase at each step

#### Task 4.2: End-to-end test: agent spawning updates status line
**File**: `watcher/test/integration/agent-status-flow.test.ts`
**Behavior**: Simulates agent spawn/complete and verifies status line updates
**Acceptance Criteria**:
- AC-4.2.1: Agent start shows in workflow-state.json
- AC-4.2.2: Agent complete clears from workflow-state.json
- AC-4.2.3: oss-statusline.sh shows agent while active

## Task Summary

| Phase | Task | Description | Est. Tests |
|-------|------|-------------|------------|
| 1 | 1.1 | Phase state updates on start | 4 |
| 1 | 1.2 | Phase state updates on complete | 2 |
| 1 | 1.3 | Implement in oss-log.sh | 0 (impl) |
| 2 | 2.1 | Extend WorkflowState type | 2 |
| 2 | 2.2 | Add setActiveAgent method | 2 |
| 2 | 2.3 | Add CLI commands | 2 |
| 2 | 2.4 | oss-log.sh agent updates state | 4 |
| 3 | 3.1 | Status line shows tddPhase | 3 |
| 3 | 3.2 | Status line shows activeAgent | 2 |
| 3 | 3.3 | Implement in oss-statusline.sh | 0 (impl) |
| 4 | 4.1 | E2E TDD phase flow | 2 |
| 4 | 4.2 | E2E agent status flow | 3 |

**Total: 12 tasks, ~26 new tests**

## Files to Modify

1. `hooks/oss-log.sh` - Add workflow state updates for phase and agent commands
2. `watcher/src/services/workflow-state.ts` - Add activeAgent field and methods
3. `watcher/src/cli/update-workflow-state.ts` - Add setActiveAgent/clearActiveAgent CLI commands
4. `hooks/oss-statusline.sh` - Display activeAgent when set (already displays tddPhase)
5. `watcher/test/hooks/oss-log-phase-state.test.ts` - New test file
6. `watcher/test/hooks/oss-log-agent-state.test.ts` - New test file
7. `watcher/test/integration/tdd-status-flow.test.ts` - New test file
8. `watcher/test/integration/agent-status-flow.test.ts` - New test file

## Command Chain

After planning is complete:
1. `/oss:acceptance` - Write acceptance tests for status line updates
2. `/oss:build` - Execute TDD tasks
3. `/oss:ship` - Quality gates, commit, PR

## Dependencies

- `jq` for JSON parsing in bash scripts (already required)
- `node` for running update-workflow-state.js CLI (already required)

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| oss-log.sh becomes slow if update-workflow-state.js is slow | Medium | Run state update in background with `&` |
| Agent type detection in message parsing is fragile | Low | Use structured JSON format instead of text parsing |
| tddPhase not cleared properly | Medium | Add explicit clear on workflow complete |

---

**Last Updated**: 2025-12-21
**Phase**: Plan
**Status**: Ready for /oss:acceptance
