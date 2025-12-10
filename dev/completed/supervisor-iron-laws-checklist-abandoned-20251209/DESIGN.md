# Design: Supervisor Iron Laws Checklist Integration

## Overview

Enhance WatcherSupervisor to generate and log a complete IRON LAWS checklist (all 6 laws) when commands complete. This ensures every workflow execution is evaluated against all non-negotiable development rules.

## Problem Statement

**Current State:**
- Iron law violations are detected individually by IronLawMonitor
- Checklist structure exists in WorkflowLogger but is never populated
- Only 4 of 6 laws are actively monitored (missing LAW #2, #3)
- No checklist is logged at command completion

**Desired State:**
- All 6 IRON LAWS evaluated at command completion
- Complete checklist logged to workflow.log
- Failed laws trigger auto-correction (Announce + Auto-Correct mode)
- Clear compliance visibility in logs

## Design Decisions

### D1: Checklist Evaluation Trigger

**Decision:** Evaluate checklist when `COMPLETE` or `AGENT_COMPLETE` events are detected in logs.

**Rationale:**
- Aligns with existing WorkflowLogger completion patterns
- Provides meaningful checkpoint for compliance
- Non-invasive to existing command implementations

### D2: All 6 Laws Must Be Evaluated

**Decision:** Evaluate ALL 6 IRON LAWS - no exceptions.

| Law | Detection Method |
|-----|------------------|
| LAW #1 TDD | Source files have corresponding test files |
| LAW #2 Behavior Tests | No bad mock patterns in recent test files |
| LAW #3 No Loops | No repeated tool calls / stuck patterns |
| LAW #4 Feature Branch | Not on main/master branch |
| LAW #5 Delegation | Task tool used for specialized work |
| LAW #6 Dev Docs | dev/active/{feature}/ docs updated |

**Rationale:** IRON LAWS are non-negotiable. Partial compliance is non-compliance.

### D3: LAW #2 Detection Strategy

**Decision:** Use heuristic pattern matching on test files.

**Anti-patterns to detect (implementation-focused tests):**
1. Mocking internal modules (not collaborators)
2. Testing private methods directly
3. Overly specific implementation assertions
4. Accessing private properties

**Patterns:**
```typescript
const BAD_PATTERNS = [
  /jest\.mock\(['"]\.\.\/(?!.*service|repository|client)/,  // Internal mocks
  /\['private.*'\]/,                                         // Private method access
  /expect\(.*\._/,                                           // Private properties
  /\.toHaveBeenCalledTimes\(\d{2,}\)/,                      // Overly specific counts
];
```

**Rationale:** Static analysis provides reasonable detection without runtime overhead.

### D4: LAW #3 Detection Strategy

**Decision:** Integrate with existing WorkflowAnalyzer loop detection.

**Loop indicators:**
- Same tool called 5+ times consecutively
- Same resource polled for >60 seconds
- Same error message 3+ times

**Rationale:** WorkflowAnalyzer already detects these patterns for intervention generation.

### D5: LAW #5 Detection Strategy

**Decision:** Track Task tool usage in IronLawMonitor state.

**Evaluation:**
- If specialized code was written, check if Task tool was used
- Technology detection via file extensions and content patterns
- Compare against agent delegation table

**Rationale:** Task tool is the mechanism for agent delegation in Claude Code.

### D6: Failed Laws Trigger Auto-Correction

**Decision:** When checklist has failures, queue corrective tasks automatically.

**Behavior:**
1. Log complete checklist (with failures marked)
2. Generate notification with failed laws
3. Queue corrective task for each failed law
4. No user confirmation required (per IRON LAW enforcement mode)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    IRON LAWS CHECKLIST FLOW                     │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │ IronLawMonitor  │    │ WorkflowAnalyzer│                    │
│  │ (Laws 1,4,5,6)  │    │ (Law 3 - loops) │                    │
│  └────────┬────────┘    └────────┬────────┘                    │
│           │                      │                              │
│           └──────────┬───────────┘                              │
│                      ▼                                          │
│  ┌─────────────────────────────────────────┐                   │
│  │ IronLawChecklistService (NEW)           │                   │
│  │                                         │                   │
│  │ evaluate(context):                      │                   │
│  │   law1_tdd: checkTdd()                  │                   │
│  │   law2_behavior_tests: checkBehavior()  │                   │
│  │   law3_no_loops: checkLoops()           │                   │
│  │   law4_feature_branch: checkBranch()    │                   │
│  │   law5_delegation: checkDelegation()    │                   │
│  │   law6_docs_synced: checkDocs()         │                   │
│  └────────────────────┬────────────────────┘                   │
│                       ▼                                         │
│  ┌─────────────────────────────────────────┐                   │
│  │ WatcherSupervisor                       │                   │
│  │                                         │                   │
│  │ On COMPLETE event:                      │                   │
│  │   checklist = checklistService.eval()   │                   │
│  │   logEntry.ironLaws = checklist         │                   │
│  │   if (failures) → queueCorrection()     │                   │
│  └────────────────────┬────────────────────┘                   │
│                       ▼                                         │
│  ┌─────────────────────────────────────────┐                   │
│  │ WorkflowLogger                          │                   │
│  │                                         │                   │
│  │ # IRON LAW COMPLIANCE:                  │                   │
│  │ #   [✓] LAW #1: TDD                     │                   │
│  │ #   [✓] LAW #2: Behavior tests          │                   │
│  │ #   [✓] LAW #3: No loops                │                   │
│  │ #   [✓] LAW #4: Feature branch          │                   │
│  │ #   [✓] LAW #5: Delegation              │                   │
│  │ #   [✓] LAW #6: Dev docs synced         │                   │
│  │ #   Result: 6/6 laws observed           │                   │
│  └─────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

## Interface Definitions

### IronLawChecklist (existing)

```typescript
export interface IronLawChecklist {
  law1_tdd: boolean;              // Tests written before code
  law2_behavior_tests: boolean;   // Tests verify behavior, not implementation
  law3_no_loops: boolean;         // No stuck processes or infinite loops
  law4_feature_branch: boolean;   // On feature branch, not main
  law5_delegation: boolean;       // Specialized agents used when appropriate
  law6_docs_synced: boolean;      // Dev docs updated
}
```

### ChecklistEvaluationContext (new)

```typescript
export interface ChecklistEvaluationContext {
  command: string;                    // Current command (e.g., 'build')
  phase?: string;                     // TDD phase if applicable
  recentFileChanges: FileChange[];    // Files modified during command
  recentToolCalls: ToolCall[];        // Tools used during command
  recentTestFiles: string[];          // Test files touched
  activeFeature?: string;             // Feature being worked on
  loopDetected: boolean;              // From WorkflowAnalyzer
  violations: IronLawViolation[];     // Current violations from monitor
}
```

### IronLawChecklistService (new)

```typescript
export class IronLawChecklistService {
  constructor(
    private ironLawMonitor: IronLawMonitor,
    private workflowAnalyzer: WorkflowAnalyzer
  ) {}

  /**
   * Evaluate compliance for all 6 IRON LAWS
   */
  async evaluate(context: ChecklistEvaluationContext): Promise<IronLawChecklist> {
    return {
      law1_tdd: await this.evaluateTdd(context),
      law2_behavior_tests: this.evaluateBehaviorTests(context),
      law3_no_loops: this.evaluateNoLoops(context),
      law4_feature_branch: await this.evaluateFeatureBranch(context),
      law5_delegation: this.evaluateDelegation(context),
      law6_docs_synced: await this.evaluateDocsSynced(context),
    };
  }

  /**
   * Generate correction tasks for failed laws
   */
  generateCorrections(checklist: IronLawChecklist): QueueTask[] {
    const tasks: QueueTask[] = [];

    if (!checklist.law1_tdd) {
      tasks.push({ priority: 'high', task: 'Write missing tests for new code' });
    }
    if (!checklist.law2_behavior_tests) {
      tasks.push({ priority: 'medium', task: 'Refactor tests to verify behavior, not implementation' });
    }
    if (!checklist.law3_no_loops) {
      tasks.push({ priority: 'critical', task: 'Break detected loop - kill process or try different approach' });
    }
    if (!checklist.law4_feature_branch) {
      tasks.push({ priority: 'critical', task: 'Create feature branch from main before continuing' });
    }
    if (!checklist.law5_delegation) {
      tasks.push({ priority: 'medium', task: 'Delegate specialized work to appropriate agent' });
    }
    if (!checklist.law6_docs_synced) {
      tasks.push({ priority: 'high', task: 'Update dev/active/{feature}/ documentation' });
    }

    return tasks;
  }
}
```

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `watcher/src/services/iron-law-checklist.ts` | CREATE | New service evaluating all 6 laws |
| `watcher/src/services/iron-law-monitor.ts` | MODIFY | Add `checkBehaviorTests()` method |
| `watcher/src/supervisor/watcher-supervisor.ts` | MODIFY | Integrate checklist on COMPLETE events |
| `watcher/test/services/iron-law-checklist.test.ts` | CREATE | Tests for new service |
| `watcher/test/services/iron-law-monitor.test.ts` | MODIFY | Tests for behavior check |

## Test Strategy

### Unit Tests (TDD - RED first)

1. **IronLawChecklistService**
   - `evaluate()` returns all 6 laws
   - Each law evaluator returns correct boolean
   - `generateCorrections()` creates tasks for failed laws
   - Context with no issues returns all true
   - Context with violations returns appropriate false values

2. **Behavior Test Detection (LAW #2)**
   - Detects internal module mocking
   - Detects private method testing
   - Passes for proper London TDD tests
   - Handles edge cases (no test files, empty files)

3. **WatcherSupervisor Integration**
   - Checklist generated on COMPLETE event
   - Checklist passed to WorkflowLogger
   - Failed laws trigger correction queue
   - Notifications include checklist summary

### Integration Tests

1. End-to-end: Command completion → checklist in logs
2. End-to-end: Failed law → correction task queued

## Acceptance Criteria

- [ ] All 6 IRON LAWS are evaluated at command completion
- [ ] Checklist appears in workflow.log for COMPLETE events
- [ ] Failed laws are clearly marked with [✗]
- [ ] Correction tasks are auto-queued for failed laws
- [ ] LAW #2 detection catches internal module mocking
- [ ] LAW #3 integrates with existing loop detection
- [ ] LAW #5 tracks Task tool usage for delegation

## Out of Scope

- Deep static analysis of test quality
- Runtime test execution analysis
- Historical compliance tracking
- Compliance reporting dashboard

## Dependencies

- Existing IronLawMonitor service
- Existing WorkflowAnalyzer service
- Existing WorkflowLogger with checklist formatting
- Existing QueueManager for correction tasks
