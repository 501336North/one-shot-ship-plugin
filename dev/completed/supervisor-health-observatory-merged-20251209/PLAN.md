# Implementation Plan: Supervisor Health Observatory

## Summary

Enhance the existing health check system to provide comprehensive system health observability. The supervisor will monitor 8 key health indicators and can detect anomalies, self-heal, or notify when issues arise.

## Design Reference

User request: Make health check observe:
1. Command logging (meaningful data for supervisor)
2. Dev docs synchronization
3. Agent delegation usage
4. Queue & Supervisor health
5. Archive functionality
6. Parallel quality gates
7. Notification system health
8. Last agent commit to main (staleness)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  Supervisor Health Observatory               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │HealthChecker │───▶│HealthReport  │───▶│HealthAction  │  │
│  │   Service    │    │   Generator  │    │   Handler    │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                    │                    │         │
│         ▼                    ▼                    ▼         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   8 Health Indicators                 │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ 1. CommandLogHealth    - Are commands logging data?   │  │
│  │ 2. DevDocsHealth       - Are dev docs in sync?        │  │
│  │ 3. DelegationHealth    - Are agents being delegated?  │  │
│  │ 4. QueueHealth         - Is queue functioning?        │  │
│  │ 5. ArchiveHealth       - Are features archiving?      │  │
│  │ 6. QualityGateHealth   - Are quality gates working?   │  │
│  │ 7. NotificationHealth  - Are notifications firing?    │  │
│  │ 8. BranchStaleness     - Time since last main commit  │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                │
│                            ▼                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   Action Outputs                      │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ - Queue task for self-healing                         │  │
│  │ - Send notification with actionable suggestion        │  │
│  │ - Log suspicious patterns for audit                   │  │
│  │ - Update SwiftBar with health status                  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## TDD Implementation Tasks

### Phase 1: Foundation - Health Indicator Types (4 tasks)

#### Task 1.1: Define HealthIndicator types

**Objective**: Create TypeScript types for all 8 health indicators

**Tests to Write (RED step)**:
- [ ] Test: `should define HealthIndicatorType enum with 8 values`
  - File: `watcher/test/health/health-indicator-types.test.ts`
  - Assertion: Enum has 8 values matching indicator names
- [ ] Test: `should define HealthIndicatorStatus with healthy/degraded/unhealthy states`
  - File: `watcher/test/health/health-indicator-types.test.ts`
  - Assertion: Status enum has correct values
- [ ] Test: `should define HealthIndicatorResult interface`
  - File: `watcher/test/health/health-indicator-types.test.ts`
  - Assertion: Interface has indicator, status, message, action fields

**Implementation (GREEN step)**:
- File: `watcher/src/health/types.ts`
- Types to create:
  - `HealthIndicatorType` enum
  - `HealthIndicatorStatus` enum
  - `HealthIndicatorResult` interface
  - `HealthCheckResult` aggregate type

**Refactor (REFACTOR step)**:
- [ ] Ensure consistent naming with existing types
- [ ] Add JSDoc comments for each type

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Types are exported from watcher/src/index.ts

---

#### Task 1.2: Define HealthAction types

**Objective**: Create types for health-triggered actions

**Tests to Write (RED step)**:
- [ ] Test: `should define HealthActionType with queue/notify/log/menubar values`
  - File: `watcher/test/health/health-action-types.test.ts`
  - Assertion: Action types are defined
- [ ] Test: `should define HealthAction interface with type, priority, payload`
  - File: `watcher/test/health/health-action-types.test.ts`
  - Assertion: Interface has required fields

**Implementation (GREEN step)**:
- File: `watcher/src/health/types.ts`
- Add `HealthActionType` enum and `HealthAction` interface

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Actions can be created for any health indicator

---

### Phase 2: Individual Health Checkers (8 tasks)

#### Task 2.1: CommandLogHealthChecker

**Objective**: Check if commands are logging meaningful data

**Tests to Write (RED step)**:
- [ ] Test: `should return healthy when recent logs have structured data`
  - File: `watcher/test/health/checkers/command-log.test.ts`
  - Assertion: Returns `{ status: 'healthy' }` when logs exist with JSON entries
- [ ] Test: `should return degraded when logs are empty or missing timestamps`
  - File: `watcher/test/health/checkers/command-log.test.ts`
  - Assertion: Returns `{ status: 'degraded', action: 'queue' }`
- [ ] Test: `should return unhealthy when no logs for 15+ minutes during active session`
  - File: `watcher/test/health/checkers/command-log.test.ts`
  - Assertion: Returns `{ status: 'unhealthy', action: 'notify' }`

**Implementation (GREEN step)**:
- File: `watcher/src/health/checkers/command-log-checker.ts`
- Class: `CommandLogHealthChecker`
- Methods:
  - `check(sessionLogPath: string): Promise<HealthIndicatorResult>`
  - Reads session.log, parses JSON lines, checks recency

**Acceptance Criteria**:
- [ ] Detects missing/empty logs
- [ ] Detects stale logs (no activity during active session)
- [ ] Returns actionable suggestions

---

#### Task 2.2: DevDocsHealthChecker

**Objective**: Verify dev docs are in sync with work

**Tests to Write (RED step)**:
- [ ] Test: `should return healthy when PROGRESS.md updated within 1 hour`
  - File: `watcher/test/health/checkers/dev-docs.test.ts`
  - Assertion: Status is healthy when PROGRESS.md mtime < 1 hour ago
- [ ] Test: `should return degraded when PROGRESS.md is stale (>1 hour)`
  - File: `watcher/test/health/checkers/dev-docs.test.ts`
  - Assertion: Status is degraded with update reminder
- [ ] Test: `should return unhealthy when required docs missing`
  - File: `watcher/test/health/checkers/dev-docs.test.ts`
  - Assertion: Status is unhealthy when PLAN.md/PROGRESS.md missing

**Implementation (GREEN step)**:
- File: `watcher/src/health/checkers/dev-docs-checker.ts`
- Class: `DevDocsHealthChecker`
- Methods:
  - `check(activeFeaturePath: string): Promise<HealthIndicatorResult>`
  - Checks for PLAN.md, PROGRESS.md, TESTING.md existence and freshness

**Acceptance Criteria**:
- [ ] Detects missing dev docs
- [ ] Detects stale PROGRESS.md
- [ ] Provides create/update actions

---

#### Task 2.3: DelegationHealthChecker

**Objective**: Verify agents are being delegated for specialized work

**Tests to Write (RED step)**:
- [ ] Test: `should return healthy when AGENT entries found in logs`
  - File: `watcher/test/health/checkers/delegation.test.ts`
  - Assertion: Healthy when session.log has `[AGENT]` entries
- [ ] Test: `should return degraded when no delegation in 30+ minutes of active work`
  - File: `watcher/test/health/checkers/delegation.test.ts`
  - Assertion: Degraded with reminder to delegate
- [ ] Test: `should detect specialized code without delegation`
  - File: `watcher/test/health/checkers/delegation.test.ts`
  - Assertion: Unhealthy when TypeScript/React code written without typescript-pro/react-specialist

**Implementation (GREEN step)**:
- File: `watcher/src/health/checkers/delegation-checker.ts`
- Class: `DelegationHealthChecker`
- Methods:
  - `check(sessionLog: string, recentFiles: string[]): Promise<HealthIndicatorResult>`
  - Parses [AGENT] log entries, checks against file types modified

**Acceptance Criteria**:
- [ ] Tracks delegation frequency
- [ ] Detects missing delegation for specialized code
- [ ] Suggests appropriate agents

---

#### Task 2.4: QueueHealthChecker

**Objective**: Verify queue system is functioning properly

**Tests to Write (RED step)**:
- [ ] Test: `should return healthy when queue is accessible and processing`
  - File: `watcher/test/health/checkers/queue.test.ts`
  - Assertion: Healthy when queue.json readable and tasks have timestamps
- [ ] Test: `should return degraded when queue has stale tasks (>1 hour pending)`
  - File: `watcher/test/health/checkers/queue.test.ts`
  - Assertion: Degraded when critical/high tasks pending too long
- [ ] Test: `should return unhealthy when queue file corrupted or supervisor stuck`
  - File: `watcher/test/health/checkers/queue.test.ts`
  - Assertion: Unhealthy when JSON parse fails or supervisor idle too long

**Implementation (GREEN step)**:
- File: `watcher/src/health/checkers/queue-checker.ts`
- Class: `QueueHealthChecker`
- Methods:
  - `check(queuePath: string, supervisorState: string): Promise<HealthIndicatorResult>`
  - Validates queue file, checks task ages, checks supervisor heartbeat

**Acceptance Criteria**:
- [ ] Detects corrupted queue
- [ ] Detects stale critical tasks
- [ ] Detects stuck supervisor

---

#### Task 2.5: ArchiveHealthChecker

**Objective**: Verify features are being archived when complete

**Tests to Write (RED step)**:
- [ ] Test: `should return healthy when no completed features in dev/active/`
  - File: `watcher/test/health/checkers/archive.test.ts`
  - Assertion: Healthy when all active features are in progress
- [ ] Test: `should return degraded when completed features not archived`
  - File: `watcher/test/health/checkers/archive.test.ts`
  - Assertion: Degraded when PROGRESS.md shows "ship" phase but not archived
- [ ] Test: `should call oss-archive-check.sh in dry-run mode`
  - File: `watcher/test/health/checkers/archive.test.ts`
  - Assertion: Uses existing archive-check.sh script

**Implementation (GREEN step)**:
- File: `watcher/src/health/checkers/archive-checker.ts`
- Class: `ArchiveHealthChecker`
- Methods:
  - `check(devActivePath: string): Promise<HealthIndicatorResult>`
  - Uses existing oss-archive-check.sh --dry-run

**Acceptance Criteria**:
- [ ] Integrates with existing archive-check.sh
- [ ] Detects features ready for archive
- [ ] Suggests archive command

---

#### Task 2.6: QualityGateHealthChecker

**Objective**: Verify parallel quality gates are working

**Tests to Write (RED step)**:
- [ ] Test: `should return healthy when quality checks complete successfully`
  - File: `watcher/test/health/checkers/quality-gate.test.ts`
  - Assertion: Healthy when logs show code-review, performance, security passed
- [ ] Test: `should return degraded when quality checks skipped or partial`
  - File: `watcher/test/health/checkers/quality-gate.test.ts`
  - Assertion: Degraded when not all 3 gates ran
- [ ] Test: `should return unhealthy when quality checks failing`
  - File: `watcher/test/health/checkers/quality-gate.test.ts`
  - Assertion: Unhealthy when any gate failed

**Implementation (GREEN step)**:
- File: `watcher/src/health/checkers/quality-gate-checker.ts`
- Class: `QualityGateHealthChecker`
- Methods:
  - `check(sessionLog: string): Promise<HealthIndicatorResult>`
  - Parses logs for quality gate execution and results

**Acceptance Criteria**:
- [ ] Tracks all 3 quality gates (code-review, performance, security)
- [ ] Detects missing or failed gates
- [ ] Suggests running missing gates

---

#### Task 2.7: NotificationHealthChecker

**Objective**: Verify notification system is working

**Tests to Write (RED step)**:
- [ ] Test: `should return healthy when recent notifications sent successfully`
  - File: `watcher/test/health/checkers/notification.test.ts`
  - Assertion: Healthy when notification log shows recent sends
- [ ] Test: `should return degraded when notification method unavailable`
  - File: `watcher/test/health/checkers/notification.test.ts`
  - Assertion: Degraded when terminal-notifier/osascript not found
- [ ] Test: `should return unhealthy when notifications failing silently`
  - File: `watcher/test/health/checkers/notification.test.ts`
  - Assertion: Unhealthy when send attempts failing

**Implementation (GREEN step)**:
- File: `watcher/src/health/checkers/notification-checker.ts`
- Class: `NotificationHealthChecker`
- Methods:
  - `check(): Promise<HealthIndicatorResult>`
  - Tests notification pathway, checks for available notifiers

**Acceptance Criteria**:
- [ ] Tests notification system availability
- [ ] Detects silent failures
- [ ] Suggests notification setup

---

#### Task 2.8: BranchStalenessChecker

**Objective**: Track time since last agent commit to main

**Tests to Write (RED step)**:
- [ ] Test: `should return healthy when PR merged within 24 hours`
  - File: `watcher/test/health/checkers/branch-staleness.test.ts`
  - Assertion: Healthy when recent merge to main
- [ ] Test: `should return degraded when no merge for 3+ days`
  - File: `watcher/test/health/checkers/branch-staleness.test.ts`
  - Assertion: Degraded with ship reminder
- [ ] Test: `should return unhealthy when branch diverged significantly`
  - File: `watcher/test/health/checkers/branch-staleness.test.ts`
  - Assertion: Unhealthy when 10+ commits behind main

**Implementation (GREEN step)**:
- File: `watcher/src/health/checkers/branch-staleness-checker.ts`
- Class: `BranchStalenessChecker`
- Methods:
  - `check(): Promise<HealthIndicatorResult>`
  - Uses git log to find last merge, calculates staleness

**Acceptance Criteria**:
- [ ] Tracks last merge to main
- [ ] Calculates branch divergence
- [ ] Suggests shipping or rebasing

---

### Phase 3: Health Observatory Service (3 tasks)

#### Task 3.1: HealthObservatory orchestrator

**Objective**: Create main service that runs all health checks

**Tests to Write (RED step)**:
- [ ] Test: `should run all 8 health checkers`
  - File: `watcher/test/health/health-observatory.test.ts`
  - Assertion: All checkers called, results aggregated
- [ ] Test: `should return aggregate health status`
  - File: `watcher/test/health/health-observatory.test.ts`
  - Assertion: Returns overall healthy/degraded/unhealthy based on worst indicator
- [ ] Test: `should generate HealthReport with all indicators`
  - File: `watcher/test/health/health-observatory.test.ts`
  - Assertion: Report contains all 8 indicator results

**Implementation (GREEN step)**:
- File: `watcher/src/health/health-observatory.ts`
- Class: `HealthObservatory`
- Methods:
  - `check(): Promise<HealthReport>`
  - `getOverallStatus(results: HealthIndicatorResult[]): HealthIndicatorStatus`

**Acceptance Criteria**:
- [ ] Runs all checkers in parallel
- [ ] Aggregates results into report
- [ ] Determines overall health status

---

#### Task 3.2: HealthActionHandler

**Objective**: Handle actions based on health check results

**Tests to Write (RED step)**:
- [ ] Test: `should queue task when action is 'queue'`
  - File: `watcher/test/health/health-action-handler.test.ts`
  - Assertion: QueueManager.addTask called with correct anomaly
- [ ] Test: `should send notification when action is 'notify'`
  - File: `watcher/test/health/health-action-handler.test.ts`
  - Assertion: Notification sent with health warning
- [ ] Test: `should log suspicious patterns when action is 'log'`
  - File: `watcher/test/health/health-action-handler.test.ts`
  - Assertion: Entry added to session log with [HEALTH] prefix
- [ ] Test: `should update SwiftBar when action is 'menubar'`
  - File: `watcher/test/health/health-action-handler.test.ts`
  - Assertion: Menubar service called with health status

**Implementation (GREEN step)**:
- File: `watcher/src/health/health-action-handler.ts`
- Class: `HealthActionHandler`
- Methods:
  - `handle(action: HealthAction): Promise<void>`
  - Dispatches to queue, notify, log, or menubar

**Acceptance Criteria**:
- [ ] Handles all 4 action types
- [ ] Integrates with existing QueueManager
- [ ] Integrates with existing notification system

---

#### Task 3.3: Health Check CLI enhancement

**Objective**: Enhance health-check.ts CLI to use new observatory

**Tests to Write (RED step)**:
- [ ] Test: `should use HealthObservatory instead of just npm test`
  - File: `watcher/test/cli/health-check-enhanced.test.ts`
  - Assertion: CLI calls HealthObservatory.check()
- [ ] Test: `should output all 8 indicators in verbose mode`
  - File: `watcher/test/cli/health-check-enhanced.test.ts`
  - Assertion: Output includes all indicator statuses
- [ ] Test: `should write health report to health-check.log`
  - File: `watcher/test/cli/health-check-enhanced.test.ts`
  - Assertion: Log file contains structured health report

**Implementation (GREEN step)**:
- File: `watcher/src/cli/health-check.ts` (modify existing)
- Enhance to:
  - Run npm test (existing behavior)
  - Run HealthObservatory.check() for additional indicators
  - Output combined report

**Acceptance Criteria**:
- [ ] Backward compatible with existing health check
- [ ] Adds 8 new health indicators
- [ ] Outputs comprehensive report

---

### Phase 4: Integration (3 tasks)

#### Task 4.1: SwiftBar health display

**Objective**: Show health status in SwiftBar menu

**Tests to Write (RED step)**:
- [ ] Test: `should display health indicator summary in menu`
  - File: `watcher/test/integration/swiftbar-health.test.ts`
  - Assertion: Menu shows health section with 8 indicators
- [ ] Test: `should show overall health status icon`
  - File: `watcher/test/integration/swiftbar-health.test.ts`
  - Assertion: Icon changes based on health (green/yellow/red)

**Implementation (GREEN step)**:
- File: `swiftbar/oss-workflow.1s.sh` (modify existing)
- Add health section that reads from health report

**Acceptance Criteria**:
- [ ] Health status visible in menu bar
- [ ] Indicators clickable for details

---

#### Task 4.2: Session start health check

**Objective**: Run full health check on session start

**Tests to Write (RED step)**:
- [ ] Test: `should run health observatory on session start`
  - File: `watcher/test/integration/session-health.test.ts`
  - Assertion: oss-session-start.sh calls enhanced health check
- [ ] Test: `should queue tasks for unhealthy indicators`
  - File: `watcher/test/integration/session-health.test.ts`
  - Assertion: Tasks queued for issues found

**Implementation (GREEN step)**:
- File: `hooks/oss-session-start.sh` (modify existing)
- Add call to health-check CLI after basic setup

**Acceptance Criteria**:
- [ ] Health check runs automatically on session start
- [ ] Issues queued for resolution

---

#### Task 4.3: Periodic health monitoring

**Objective**: Run health checks periodically during session

**Tests to Write (RED step)**:
- [ ] Test: `should run health check every 15 minutes`
  - File: `watcher/test/integration/periodic-health.test.ts`
  - Assertion: Timer triggers health check
- [ ] Test: `should not spam notifications for persistent issues`
  - File: `watcher/test/integration/periodic-health.test.ts`
  - Assertion: Same issue notified max once per hour

**Implementation (GREEN step)**:
- File: `watcher/src/health/health-scheduler.ts` (new)
- Class: `HealthScheduler`
- Runs health checks periodically, debounces notifications

**Acceptance Criteria**:
- [ ] Periodic monitoring without notification spam
- [ ] Configurable interval via settings

---

## Testing Strategy

### Unit Tests
- [ ] Types and interfaces (Phase 1)
- [ ] Individual checkers (Phase 2)
- [ ] Observatory and handlers (Phase 3)

### Integration Tests
- [ ] SwiftBar display
- [ ] Session lifecycle
- [ ] Notification delivery

### Edge Cases
- [ ] Missing files/directories
- [ ] Corrupted JSON
- [ ] Git not initialized
- [ ] No active session

## Security Checklist
- [ ] No sensitive data in health logs
- [ ] Git operations read-only
- [ ] Queue modifications through safe API

## Performance Considerations
- [ ] Run checkers in parallel (Promise.all)
- [ ] Cache git status during check cycle
- [ ] Debounce notifications (1 per issue per hour)

## Estimated Tasks: 18
## Estimated Test Cases: 45+

---

## After the Plan - Command Chain

```
/oss:plan
    |
    v
/oss:acceptance    --> Write acceptance tests for HealthObservatory
    |
    v
/oss:build         --> Execute TDD tasks (18 tasks)
    |   |-- /oss:red      --> Write failing tests
    |   |-- /oss:green    --> Implement checkers
    |   |-- /oss:refactor --> Clean up
    |
    v
/oss:integration   --> Validate SwiftBar/session integration
    |
    v
/oss:ship          --> Quality gates + PR
```

---

*Plan created: 2024-12-09*
*Estimated implementation: 18 TDD tasks across 4 phases*
