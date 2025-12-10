# TDD Implementation Plan: Supervisor Agent with Structured Logging

## Overview

This plan follows London-style TDD: RED -> GREEN -> REFACTOR for each phase.
All tests written FIRST, then implementation to pass tests.

## Phase 1: WorkflowLogger (Foundation)

### RED: Write failing tests

```typescript
// watcher/test/workflow-logger.test.ts
describe('WorkflowLogger', () => {
  describe('log()', () => {
    it('creates .oss/workflow.log if not exists');
    it('appends JSON line with correct format');
    it('appends human-readable summary after JSON');
    it('includes timestamp in ISO 8601 format');
    it('includes cmd, event, and data fields');
    it('includes phase field when provided');
    it('includes agent field when logging agent events');
    it('writes atomically (no partial entries)');
  });

  describe('formatHumanSummary()', () => {
    it('formats START event as "CMD:START - description"');
    it('formats PHASE_START as "CMD:PHASE:START - description"');
    it('formats COMPLETE with summary from data');
    it('formats FAILED with error from data');
    it('formats AGENT events with agent type');
  });
});
```

### GREEN: Implement WorkflowLogger

- `watcher/src/logger/workflow-logger.ts`
- Atomic append using temp file + rename
- Format functions for JSON and human summary

### REFACTOR: Clean up

- Extract format helpers
- Add JSDoc comments

---

## Phase 2: LogReader (Real-time Tailing)

### RED: Write failing tests

```typescript
// watcher/test/log-reader.test.ts
describe('LogReader', () => {
  describe('tail()', () => {
    it('reads new entries as they are appended');
    it('parses JSON lines correctly');
    it('skips human summary lines (starting with #)');
    it('emits parsed entries via callback');
    it('handles malformed JSON gracefully');
    it('tracks read position');
  });

  describe('readAll()', () => {
    it('reads all entries from beginning');
    it('returns array of parsed entries');
    it('handles empty file');
    it('handles missing file');
  });

  describe('queryLast()', () => {
    it('finds last entry matching command');
    it('finds last entry matching command and event');
    it('returns null if no match');
    it('returns data from matching entry');
  });
});
```

### GREEN: Implement LogReader

- `watcher/src/logger/log-reader.ts`
- File watching with fs.watch or polling
- Position tracking for incremental reads
- Query methods for chain memory

### REFACTOR: Clean up

- Optimize for large files (read backwards for queryLast)
- Add caching for recent queries

---

## Phase 3: WorkflowAnalyzer (Reasoning Engine)

### RED: Write failing tests

```typescript
// watcher/test/workflow-analyzer.test.ts
describe('WorkflowAnalyzer', () => {
  describe('negative signal detection (presence of bad)', () => {
    it('detects loop when same action repeated 3+ times');
    it('detects stuck phase when START without COMPLETE beyond timeout');
    it('detects regression when COMPLETE followed by FAILED');
    it('detects out-of-order when phase sequence violated');
    it('detects chain violation when command runs without predecessor');
    it('detects TDD violation when GREEN before RED');
    it('detects explicit FAILED events');
    it('detects agent failure');
  });

  describe('positive signal erosion (absence of good)', () => {
    it('detects silence (no entries for extended period while command active)');
    it('detects missing milestones (phase without expected checkpoints)');
    it('detects declining velocity (time between milestones increasing)');
    it('detects incomplete chain (command completes without expected outputs)');
    it('detects agent silence (spawned agent produces no entries)');
  });

  describe('hard stop detection (positive signals ceased)', () => {
    it('detects abrupt stop (active workflow, then nothing)');
    it('detects partial completion (some phases complete, then silence)');
    it('detects abandoned agent (agent started, never completed)');
  });

  describe('healthy workflow recognition', () => {
    it('returns healthy for normal workflow progress');
    it('returns healthy when milestones arrive at expected intervals');
    it('returns healthy when phases complete in order');
  });

  describe('confidence scoring', () => {
    it('returns high confidence for clear loops (>0.9)');
    it('returns high confidence for explicit failures (>0.9)');
    it('returns medium confidence for timing-based issues (0.7-0.9)');
    it('returns medium confidence for missing milestones (0.7-0.9)');
    it('returns low confidence for velocity decline (<0.7)');
  });

  describe('state tracking', () => {
    it('tracks current command and phase');
    it('tracks phase start time');
    it('tracks last activity time');
    it('tracks milestone timestamps for velocity');
    it('tracks active agents');
    it('tracks expected vs actual milestones');
    it('updates chain progress');
  });
});
```

### GREEN: Implement WorkflowAnalyzer

- `watcher/src/analyzer/workflow-analyzer.ts`
- State machine for workflow tracking
- Issue detection logic with confidence scoring
- Configurable timeouts and thresholds

### REFACTOR: Clean up

- Extract issue detectors into separate functions
- Add reasoning explanations to issues

---

## Phase 4: InterventionGenerator (Response Logic)

### RED: Write failing tests

```typescript
// watcher/test/intervention-generator.test.ts
describe('InterventionGenerator', () => {
  describe('generate()', () => {
    it('creates auto-remediate response for high confidence');
    it('creates notify-suggest response for medium confidence');
    it('creates notify-only response for low confidence');
    it('includes queue task with correct priority for auto-remediate');
    it('includes queue task with prompt for suggested action');
    it('includes notification for all response types');
    it('selects appropriate agent for issue type');
  });

  describe('createPrompt()', () => {
    it('generates clear prompt describing the issue');
    it('includes evidence from log entries');
    it('includes suggested action');
    it('formats for Claude readability');
  });

  describe('createNotification()', () => {
    it('creates title with issue type');
    it('creates message with actionable info');
    it('uses appropriate sound for severity');
  });
});
```

### GREEN: Implement InterventionGenerator

- `watcher/src/intervention/generator.ts`
- Response type selection based on confidence
- Queue task creation
- Notification creation

### REFACTOR: Clean up

- Extract prompt templates
- Add agent selection logic

---

## Phase 5: Watcher Integration

### RED: Write failing tests

```typescript
// watcher/test/watcher-supervisor.test.ts
describe('Watcher Supervisor Mode', () => {
  describe('workflow monitoring', () => {
    it('starts LogReader on watcher start');
    it('passes new entries to WorkflowAnalyzer');
    it('generates interventions for detected issues');
    it('writes interventions to queue');
    it('sends notifications via terminal-notifier');
  });

  describe('state persistence', () => {
    it('writes workflow state to workflow-state.json');
    it('reads state on restart');
    it('rebuilds state from log if state file missing');
  });

  describe('integration', () => {
    it('detects loop and auto-remediates');
    it('detects stuck and notifies with suggestion');
    it('handles concurrent log writes');
  });
});
```

### GREEN: Implement Supervisor Integration

- Update `watcher/src/index.ts` to include supervisor components
- Wire LogReader -> Analyzer -> InterventionGenerator -> Queue
- Add state persistence

### REFACTOR: Clean up

- Extract supervisor as separate class
- Add configuration options

---

## Phase 6: API Prompt Updates

### Changes Required

Update all `/oss:` command prompts in the API to include logging instructions:

1. **ideate prompt** - Log START, milestones, COMPLETE with outputs
2. **plan prompt** - Log START, phases (ANALYSIS, GENERATION), agent spawns, COMPLETE
3. **build prompt** - Log START, RED/GREEN/REFACTOR phases, test milestones, COMPLETE
4. **ship prompt** - Log START, quality checks, PR creation, COMPLETE

### Testing

- Integration tests verifying prompts produce expected log entries
- Manual testing of full workflow chain

---

## Phase 7: End-to-End Integration

### RED: Write failing tests

```typescript
// watcher/test/e2e/supervisor-e2e.test.ts
describe('Supervisor E2E', () => {
  it('full chain produces valid workflow log');
  it('watcher detects simulated loop and intervenes');
  it('watcher detects simulated stuck and notifies');
  it('commands read chain memory from log');
  it('intervention appears in queue and Claude sees it');
});
```

### GREEN: Implement E2E

- Set up test fixtures with sample log sequences
- Verify full flow from log entry to intervention

### REFACTOR: Clean up

- Add more edge case coverage
- Performance optimization

---

## Test Count Estimate

| Phase | Tests |
|-------|-------|
| Phase 1: WorkflowLogger | ~13 |
| Phase 2: LogReader | ~12 |
| Phase 3: WorkflowAnalyzer | ~30 |
| Phase 4: InterventionGenerator | ~12 |
| Phase 5: Watcher Integration | ~10 |
| Phase 6: API Prompts | ~8 |
| Phase 7: E2E | ~6 |
| **Total** | **~91** |

---

## Dependencies

- Existing watcher infrastructure (QueueManager, etc.)
- terminal-notifier for notifications
- fs module for file operations

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Log file corruption | Atomic writes, graceful parsing |
| False positive interventions | Conservative confidence thresholds |
| Performance with large logs | Read backwards for queries, position tracking |
| Prompt compliance | Clear documentation, test coverage |

---

## Success Criteria

- [ ] 75+ tests passing
- [ ] Full workflow chain produces valid logs
- [ ] Watcher detects and responds to simulated issues
- [ ] Commands can query log for chain memory
- [ ] Interventions appear in queue and Claude acts on them
