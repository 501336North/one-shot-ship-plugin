# Implementation Plan: Spec Sync Daemon

## Summary

Extend WatcherSupervisor with a SpecMonitor that continuously scans for drift between feature specs (DESIGN.md, PLAN.md) and actual code, auto-reconciles simple drifts, and tracks long-term metrics.

## Design Reference

See: `.oss/dev/active/spec-sync/DESIGN.md`

---

## Implementation Phases

### Phase 1: Core Types & Spec Parser (Foundation)
**Dependencies:** None
**Estimated Tests:** 12

### Phase 2: SpecMonitor (Drift Detection)
**Dependencies:** Phase 1
**Estimated Tests:** 16

### Phase 3: SpecReconciler (Auto-fix & Queue)
**Dependencies:** Phase 1, Phase 2
**Estimated Tests:** 14

### Phase 4: SpecMetrics (Tracking)
**Dependencies:** Phase 1
**Estimated Tests:** 10

### Phase 5: Diff Generator
**Dependencies:** Phase 1, Phase 2
**Estimated Tests:** 8

### Phase 6: Build Pre-flight Integration
**Dependencies:** Phases 1-5
**Estimated Tests:** 8

### Phase 7: WatcherSupervisor Integration
**Dependencies:** Phases 1-6
**Estimated Tests:** 6

---

## TDD Implementation Tasks

---

## Phase 1: Core Types & Spec Parser

### Task 1.1: Define Spec Types

**Objective:** Create TypeScript types for spec parsing and drift detection

**Tests to Write (RED step):**
- [ ] Test: `SpecItem type should have id, description, status, and type fields`
  - File: `test/services/spec-reconciler/types.test.ts`
  - Assertion: Type compilation test
- [ ] Test: `SpecSection type should have marker, items array, and raw content`
  - File: `test/services/spec-reconciler/types.test.ts`
  - Assertion: Type compilation test
- [ ] Test: `DriftType should be union of structural_missing | structural_extra | behavioral_mismatch | criteria_incomplete`
  - File: `test/services/spec-reconciler/types.test.ts`
  - Assertion: Type compilation test
- [ ] Test: `DriftResult type should have type, confidence, description, and specItem`
  - File: `test/services/spec-reconciler/types.test.ts`
  - Assertion: Type compilation test

**Implementation (GREEN step):**
- File: `src/services/spec-reconciler/types.ts`
- Types to create:
  - `SpecItem { id: string, description: string, status: 'checked' | 'unchecked', type: 'component' | 'criterion' | 'behavior' }`
  - `SpecSection { marker: string, items: SpecItem[], raw: string }`
  - `ParsedSpec { feature: string, components: SpecSection, criteria: SpecSection, behaviors: SpecSection }`
  - `DriftType = 'structural_missing' | 'structural_extra' | 'behavioral_mismatch' | 'criteria_incomplete'`
  - `DriftResult { type: DriftType, confidence: number, description: string, specItem?: SpecItem, filePath?: string }`
  - `SpecCoverage { total: number, implemented: number, ratio: number }`
  - `FeatureMetrics { coverage: { components: SpecCoverage, criteria: SpecCoverage, behaviors: SpecCoverage }, drift: { count: number, types: DriftType[] } }`

**Refactor (REFACTOR step):**
- [ ] Extract shared types to watcher/src/types.ts if needed
- [ ] Add JSDoc comments to all types

**Acceptance Criteria:**
- [ ] All type tests pass
- [ ] Types exported from index.ts

---

### Task 1.2: Implement Spec Marker Parser

**Objective:** Parse structured markers from spec files

**Tests to Write (RED step):**
- [ ] Test: `parseSpecFile() extracts components section from <!-- spec:components --> markers`
  - File: `test/services/spec-reconciler/parser.test.ts`
  - Assertion: Returns SpecSection with correct items
- [ ] Test: `parseSpecFile() extracts criteria section from <!-- spec:criteria --> markers`
  - File: `test/services/spec-reconciler/parser.test.ts`
  - Assertion: Returns SpecSection with SC-### prefixed items
- [ ] Test: `parseSpecFile() extracts behaviors section from <!-- spec:behaviors --> markers`
  - File: `test/services/spec-reconciler/parser.test.ts`
  - Assertion: Returns SpecSection with behavior strings
- [ ] Test: `parseSpecFile() returns empty sections when markers not found`
  - File: `test/services/spec-reconciler/parser.test.ts`
  - Assertion: Returns ParsedSpec with empty sections
- [ ] Test: `parseSpecItem() parses checked item - [x] Component - Description`
  - File: `test/services/spec-reconciler/parser.test.ts`
  - Assertion: Returns SpecItem with status: 'checked'
- [ ] Test: `parseSpecItem() parses unchecked item - [ ] Component - Description`
  - File: `test/services/spec-reconciler/parser.test.ts`
  - Assertion: Returns SpecItem with status: 'unchecked'
- [ ] Test: `parseSpecFile() handles malformed markers gracefully`
  - File: `test/services/spec-reconciler/parser.test.ts`
  - Assertion: Returns partial result, no throw

**Implementation (GREEN step):**
- File: `src/services/spec-reconciler/parser.ts`
- Functions to create:
  - `parseSpecFile(content: string, featureName: string): ParsedSpec`
  - `parseSpecSection(content: string, marker: string): SpecSection`
  - `parseSpecItem(line: string, type: SpecItem['type']): SpecItem | null`
  - `extractMarkerContent(content: string, markerName: string): string`

**Refactor (REFACTOR step):**
- [ ] Extract regex patterns to constants
- [ ] Add error boundary for malformed content

**Acceptance Criteria:**
- [ ] All parser tests pass
- [ ] Can parse example spec from DESIGN.md

---

### Task 1.3: Implement File Pattern Matcher

**Objective:** Match spec component names to actual files in codebase

**Tests to Write (RED step):**
- [ ] Test: `findMatchingFile() finds auth-service.ts for AuthService component`
  - File: `test/services/spec-reconciler/file-matcher.test.ts`
  - Assertion: Returns path to matching file
- [ ] Test: `findMatchingFile() returns null when no match found`
  - File: `test/services/spec-reconciler/file-matcher.test.ts`
  - Assertion: Returns null for NonExistent component
- [ ] Test: `findMatchingFile() handles kebab-case, camelCase, PascalCase variations`
  - File: `test/services/spec-reconciler/file-matcher.test.ts`
  - Assertion: Matches UserRepository to user-repository.ts
- [ ] Test: `findExtraFiles() returns files not in spec components list`
  - File: `test/services/spec-reconciler/file-matcher.test.ts`
  - Assertion: Returns array of unspecified files

**Implementation (GREEN step):**
- File: `src/services/spec-reconciler/file-matcher.ts`
- Functions to create:
  - `findMatchingFile(componentName: string, searchPaths: string[]): Promise<string | null>`
  - `findExtraFiles(specComponents: SpecItem[], searchPaths: string[]): Promise<string[]>`
  - `normalizeComponentName(name: string): string[]` - returns possible file name variations

**Refactor (REFACTOR step):**
- [ ] Cache file list for performance
- [ ] Add configurable search paths

**Acceptance Criteria:**
- [ ] All file matcher tests pass
- [ ] Handles common naming conventions

---

## Phase 2: SpecMonitor (Drift Detection)

### Task 2.1: Implement SpecMonitor Core

**Objective:** Create SpecMonitor class following existing monitor patterns

**Tests to Write (RED step):**
- [ ] Test: `constructor() initializes with queueManager dependency`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: No throw, instance created
- [ ] Test: `scanActiveFeatures() finds all .oss/dev/active/{feature}/ directories`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: Returns array of feature names
- [ ] Test: `scanActiveFeatures() returns empty array when no active features`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: Returns []
- [ ] Test: `getSpecPath() returns DESIGN.md path for feature`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: Returns correct path string
- [ ] Test: `reset() clears internal state`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: State maps are empty

**Implementation (GREEN step):**
- File: `src/monitors/spec-monitor.ts`
- Class: `SpecMonitor`
- Methods:
  - `constructor(queueManager: QueueManager, config?: SpecMonitorConfig)`
  - `scanActiveFeatures(): Promise<string[]>`
  - `getSpecPath(feature: string): string`
  - `reset(): void`

**Refactor (REFACTOR step):**
- [ ] Add configurable base path for testing

**Acceptance Criteria:**
- [ ] All SpecMonitor core tests pass
- [ ] Follows LogMonitor pattern

---

### Task 2.2: Implement Structural Drift Detection

**Objective:** Detect when components in spec don't match codebase files

**Tests to Write (RED step):**
- [ ] Test: `detectStructuralDrift() returns structural_missing when component in spec but no file`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: DriftResult with type 'structural_missing'
- [ ] Test: `detectStructuralDrift() returns structural_extra when file exists but not in spec`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: DriftResult with type 'structural_extra'
- [ ] Test: `detectStructuralDrift() returns empty array when spec and files match`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: Returns []
- [ ] Test: `detectStructuralDrift() sets confidence 1.0 for structural drift`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: DriftResult.confidence === 1.0

**Implementation (GREEN step):**
- File: `src/monitors/spec-monitor.ts`
- Method: `detectStructuralDrift(spec: ParsedSpec, searchPaths: string[]): Promise<DriftResult[]>`

**Refactor (REFACTOR step):**
- [ ] Extract drift creation to factory function

**Acceptance Criteria:**
- [ ] All structural drift tests pass
- [ ] Returns correct drift types

---

### Task 2.3: Implement Criteria Drift Detection

**Objective:** Detect when success criteria are unchecked without test coverage

**Tests to Write (RED step):**
- [ ] Test: `detectCriteriaDrift() returns criteria_incomplete for unchecked criterion without test`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: DriftResult with type 'criteria_incomplete'
- [ ] Test: `detectCriteriaDrift() returns empty for checked criteria`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: Returns []
- [ ] Test: `detectCriteriaDrift() returns empty for unchecked criterion WITH test coverage`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: Returns [] when test file references SC-###
- [ ] Test: `detectCriteriaDrift() sets confidence 0.8 for criteria drift`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: DriftResult.confidence === 0.8

**Implementation (GREEN step):**
- File: `src/monitors/spec-monitor.ts`
- Method: `detectCriteriaDrift(spec: ParsedSpec, testSearchPaths: string[]): Promise<DriftResult[]>`

**Refactor (REFACTOR step):**
- [ ] Add test file content caching

**Acceptance Criteria:**
- [ ] All criteria drift tests pass

---

### Task 2.4: Implement Coverage Calculation

**Objective:** Calculate spec coverage ratios

**Tests to Write (RED step):**
- [ ] Test: `calculateCoverage() returns correct ratio for components (3/4 = 0.75)`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: SpecCoverage with ratio 0.75
- [ ] Test: `calculateCoverage() returns 0 when no items`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: SpecCoverage with ratio 0
- [ ] Test: `calculateCoverage() returns 1 when all items checked`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: SpecCoverage with ratio 1.0
- [ ] Test: `getFeatureMetrics() aggregates coverage across all sections`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: FeatureMetrics with all coverage fields

**Implementation (GREEN step):**
- File: `src/monitors/spec-monitor.ts`
- Methods:
  - `calculateCoverage(section: SpecSection): SpecCoverage`
  - `getFeatureMetrics(feature: string): Promise<FeatureMetrics>`

**Refactor (REFACTOR step):**
- [ ] Cache metrics with TTL

**Acceptance Criteria:**
- [ ] All coverage tests pass

---

### Task 2.5: Implement Anomaly Emission

**Objective:** Emit drift anomalies to queue system

**Tests to Write (RED step):**
- [ ] Test: `emitDriftAnomaly() creates queue task with correct source 'spec-monitor'`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: mockQueueManager.addTask called with source: 'spec-monitor'
- [ ] Test: `emitDriftAnomaly() sets priority 'high' for structural drift`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: priority: 'high' in task
- [ ] Test: `emitDriftAnomaly() sets priority 'medium' for criteria drift`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: priority: 'medium' in task
- [ ] Test: `emitDriftAnomaly() includes context with drift details`
  - File: `test/monitors/spec-monitor.test.ts`
  - Assertion: context.type matches drift type

**Implementation (GREEN step):**
- File: `src/monitors/spec-monitor.ts`
- Method: `emitDriftAnomaly(drift: DriftResult, feature: string): Promise<void>`

**Refactor (REFACTOR step):**
- [ ] Add deduplication via signature tracking

**Acceptance Criteria:**
- [ ] All anomaly emission tests pass
- [ ] Follows queue task pattern from other monitors

---

## Phase 3: SpecReconciler (Auto-fix & Queue)

### Task 3.1: Implement Drift Classifier

**Objective:** Classify drifts as simple (auto-fixable) or complex (human review)

**Tests to Write (RED step):**
- [ ] Test: `classifyDrift() returns 'simple' for unchecked component when file exists`
  - File: `test/services/spec-reconciler/reconciler.test.ts`
  - Assertion: Returns 'simple'
- [ ] Test: `classifyDrift() returns 'complex' for behavioral_mismatch`
  - File: `test/services/spec-reconciler/reconciler.test.ts`
  - Assertion: Returns 'complex'
- [ ] Test: `classifyDrift() returns 'complex' for structural_missing`
  - File: `test/services/spec-reconciler/reconciler.test.ts`
  - Assertion: Returns 'complex'
- [ ] Test: `classifyDrift() returns 'simple' when confidence > 0.9`
  - File: `test/services/spec-reconciler/reconciler.test.ts`
  - Assertion: Returns 'simple'

**Implementation (GREEN step):**
- File: `src/services/spec-reconciler/index.ts`
- Class: `SpecReconciler`
- Method: `classifyDrift(drift: DriftResult): 'simple' | 'complex'`

**Refactor (REFACTOR step):**
- [ ] Extract classification rules to config

**Acceptance Criteria:**
- [ ] All classifier tests pass

---

### Task 3.2: Implement Checkbox Auto-fixer

**Objective:** Auto-check unchecked components when file exists

**Tests to Write (RED step):**
- [ ] Test: `autoFixCheckbox() changes - [ ] to - [x] in spec file`
  - File: `test/services/spec-reconciler/auto-fixer.test.ts`
  - Assertion: File content updated correctly
- [ ] Test: `autoFixCheckbox() preserves other content in file`
  - File: `test/services/spec-reconciler/auto-fixer.test.ts`
  - Assertion: Only target line modified
- [ ] Test: `autoFixCheckbox() returns success result with details`
  - File: `test/services/spec-reconciler/auto-fixer.test.ts`
  - Assertion: { success: true, action: 'checkbox_checked' }
- [ ] Test: `autoFixCheckbox() returns failure when item not found`
  - File: `test/services/spec-reconciler/auto-fixer.test.ts`
  - Assertion: { success: false, reason: 'item_not_found' }

**Implementation (GREEN step):**
- File: `src/services/spec-reconciler/auto-fixer.ts`
- Function: `autoFixCheckbox(specPath: string, itemId: string): Promise<AutoFixResult>`

**Refactor (REFACTOR step):**
- [ ] Add backup before modification

**Acceptance Criteria:**
- [ ] All auto-fixer tests pass

---

### Task 3.3: Implement Queue Task Creator

**Objective:** Create queue tasks for complex drifts

**Tests to Write (RED step):**
- [ ] Test: `queueDriftTask() creates task with anomaly_type 'spec_drift'`
  - File: `test/services/spec-reconciler/reconciler.test.ts`
  - Assertion: Task has correct anomaly_type
- [ ] Test: `queueDriftTask() assigns 'debugger' agent for structural drift`
  - File: `test/services/spec-reconciler/reconciler.test.ts`
  - Assertion: suggested_agent: 'debugger'
- [ ] Test: `queueDriftTask() assigns 'code-reviewer' agent for behavioral drift`
  - File: `test/services/spec-reconciler/reconciler.test.ts`
  - Assertion: suggested_agent: 'code-reviewer'
- [ ] Test: `queueDriftTask() includes feature context`
  - File: `test/services/spec-reconciler/reconciler.test.ts`
  - Assertion: context.feature present

**Implementation (GREEN step):**
- File: `src/services/spec-reconciler/index.ts`
- Method: `queueDriftTask(drift: DriftResult, feature: string): Promise<void>`

**Refactor (REFACTOR step):**
- [ ] Add prompt templates for different drift types

**Acceptance Criteria:**
- [ ] All queue task tests pass

---

### Task 3.4: Implement Reconciliation Orchestrator

**Objective:** Orchestrate classification, auto-fix, and queue creation

**Tests to Write (RED step):**
- [ ] Test: `reconcile() auto-fixes simple drifts`
  - File: `test/services/spec-reconciler/reconciler.test.ts`
  - Assertion: autoFix called for simple drifts
- [ ] Test: `reconcile() queues complex drifts`
  - File: `test/services/spec-reconciler/reconciler.test.ts`
  - Assertion: queueDriftTask called for complex drifts
- [ ] Test: `reconcile() returns reconciliation report`
  - File: `test/services/spec-reconciler/reconciler.test.ts`
  - Assertion: { fixed: number, queued: number, failed: number }
- [ ] Test: `reconcile() logs all actions to workflow.log`
  - File: `test/services/spec-reconciler/reconciler.test.ts`
  - Assertion: Log entries created for each action

**Implementation (GREEN step):**
- File: `src/services/spec-reconciler/index.ts`
- Method: `reconcile(drifts: DriftResult[], feature: string): Promise<ReconciliationReport>`

**Refactor (REFACTOR step):**
- [ ] Add dry-run mode for testing

**Acceptance Criteria:**
- [ ] All orchestrator tests pass

---

## Phase 4: SpecMetrics (Tracking)

### Task 4.1: Implement Metrics Storage

**Objective:** Persist metrics to .oss/spec-metrics.json

**Tests to Write (RED step):**
- [ ] Test: `loadMetrics() reads existing metrics file`
  - File: `test/services/spec-metrics.test.ts`
  - Assertion: Returns parsed SpecMetricsFile
- [ ] Test: `loadMetrics() returns default when file not found`
  - File: `test/services/spec-metrics.test.ts`
  - Assertion: Returns { version: '1.0', features: {}, reconciliations: [] }
- [ ] Test: `saveMetrics() writes metrics to file`
  - File: `test/services/spec-metrics.test.ts`
  - Assertion: File contains JSON with correct structure
- [ ] Test: `saveMetrics() updates updated_at timestamp`
  - File: `test/services/spec-metrics.test.ts`
  - Assertion: updated_at is recent ISO timestamp

**Implementation (GREEN step):**
- File: `src/services/spec-metrics.ts`
- Class: `SpecMetricsService`
- Methods:
  - `loadMetrics(): Promise<SpecMetricsFile>`
  - `saveMetrics(metrics: SpecMetricsFile): Promise<void>`

**Refactor (REFACTOR step):**
- [ ] Add file locking for concurrent access

**Acceptance Criteria:**
- [ ] All storage tests pass

---

### Task 4.2: Implement Coverage History

**Objective:** Track coverage over time with daily snapshots

**Tests to Write (RED step):**
- [ ] Test: `updateCoverage() adds new snapshot to history`
  - File: `test/services/spec-metrics.test.ts`
  - Assertion: history array grows by 1
- [ ] Test: `updateCoverage() limits history to 90 entries`
  - File: `test/services/spec-metrics.test.ts`
  - Assertion: history.length <= 90
- [ ] Test: `updateCoverage() uses today's date for snapshot`
  - File: `test/services/spec-metrics.test.ts`
  - Assertion: Latest entry has today's date
- [ ] Test: `updateCoverage() replaces existing entry for same day`
  - File: `test/services/spec-metrics.test.ts`
  - Assertion: Only one entry per day

**Implementation (GREEN step):**
- File: `src/services/spec-metrics.ts`
- Method: `updateCoverage(feature: string, metrics: FeatureMetrics): Promise<void>`

**Refactor (REFACTOR step):**
- [ ] Add weekly aggregation

**Acceptance Criteria:**
- [ ] All history tests pass

---

### Task 4.3: Implement Velocity Calculation

**Objective:** Calculate drift velocity over time

**Tests to Write (RED step):**
- [ ] Test: `calculateVelocity() returns weekly drift average`
  - File: `test/services/spec-metrics.test.ts`
  - Assertion: velocity.weekly_drift_avg is correct
- [ ] Test: `calculateVelocity() determines trend direction`
  - File: `test/services/spec-metrics.test.ts`
  - Assertion: trend is 'improving' | 'stable' | 'degrading'
- [ ] Test: `calculateVelocity() handles insufficient data`
  - File: `test/services/spec-metrics.test.ts`
  - Assertion: Returns null when < 7 days of data

**Implementation (GREEN step):**
- File: `src/services/spec-metrics.ts`
- Method: `calculateVelocity(feature: string): Promise<VelocityMetrics | null>`

**Refactor (REFACTOR step):**
- [ ] Add configurable window size

**Acceptance Criteria:**
- [ ] All velocity tests pass

---

### Task 4.4: Implement Reconciliation Audit Trail

**Objective:** Track all reconciliation actions

**Tests to Write (RED step):**
- [ ] Test: `recordReconciliation() adds entry to reconciliations array`
  - File: `test/services/spec-metrics.test.ts`
  - Assertion: reconciliations grows by 1
- [ ] Test: `recordReconciliation() includes timestamp, feature, action`
  - File: `test/services/spec-metrics.test.ts`
  - Assertion: Entry has all required fields
- [ ] Test: `recordReconciliation() limits entries to 500`
  - File: `test/services/spec-metrics.test.ts`
  - Assertion: reconciliations.length <= 500

**Implementation (GREEN step):**
- File: `src/services/spec-metrics.ts`
- Method: `recordReconciliation(entry: ReconciliationEntry): Promise<void>`

**Refactor (REFACTOR step):**
- [ ] Add archival to separate file for old entries

**Acceptance Criteria:**
- [ ] All audit trail tests pass

---

## Phase 5: Diff Generator

### Task 5.1: Implement File Change Detection

**Objective:** Detect when files in feature scope change

**Tests to Write (RED step):**
- [ ] Test: `isFileInFeatureScope() returns true for src/ files`
  - File: `test/services/spec-reconciler/diff-generator.test.ts`
  - Assertion: Returns true
- [ ] Test: `isFileInFeatureScope() returns false for node_modules/`
  - File: `test/services/spec-reconciler/diff-generator.test.ts`
  - Assertion: Returns false
- [ ] Test: `getRelatedFeature() finds feature for file path`
  - File: `test/services/spec-reconciler/diff-generator.test.ts`
  - Assertion: Returns feature name or null

**Implementation (GREEN step):**
- File: `src/services/spec-reconciler/diff-generator.ts`
- Functions:
  - `isFileInFeatureScope(filePath: string): boolean`
  - `getRelatedFeature(filePath: string): Promise<string | null>`

**Refactor (REFACTOR step):**
- [ ] Add configurable scope patterns

**Acceptance Criteria:**
- [ ] All scope detection tests pass

---

### Task 5.2: Implement Coverage Diff Generation

**Objective:** Generate before/after coverage comparison

**Tests to Write (RED step):**
- [ ] Test: `generateCoverageDiff() shows coverage increase`
  - File: `test/services/spec-reconciler/diff-generator.test.ts`
  - Assertion: diff shows + for improved metrics
- [ ] Test: `generateCoverageDiff() shows coverage decrease`
  - File: `test/services/spec-reconciler/diff-generator.test.ts`
  - Assertion: diff shows - for degraded metrics
- [ ] Test: `generateCoverageDiff() identifies resolved drifts`
  - File: `test/services/spec-reconciler/diff-generator.test.ts`
  - Assertion: resolved array populated
- [ ] Test: `generateCoverageDiff() identifies new drifts`
  - File: `test/services/spec-reconciler/diff-generator.test.ts`
  - Assertion: new array populated

**Implementation (GREEN step):**
- File: `src/services/spec-reconciler/diff-generator.ts`
- Function: `generateCoverageDiff(before: FeatureMetrics, after: FeatureMetrics): CoverageDiff`

**Refactor (REFACTOR step):**
- [ ] Add percentage change calculation

**Acceptance Criteria:**
- [ ] All diff generation tests pass

---

### Task 5.3: Implement Diff Logging

**Objective:** Log diffs to spec-diffs.log

**Tests to Write (RED step):**
- [ ] Test: `logDiff() appends to spec-diffs.log`
  - File: `test/services/spec-reconciler/diff-generator.test.ts`
  - Assertion: File grows with new entry
- [ ] Test: `logDiff() includes timestamp and feature`
  - File: `test/services/spec-reconciler/diff-generator.test.ts`
  - Assertion: Entry has required fields
- [ ] Test: `logDiff() also logs to workflow.log`
  - File: `test/services/spec-reconciler/diff-generator.test.ts`
  - Assertion: workflow.log entry created

**Implementation (GREEN step):**
- File: `src/services/spec-reconciler/diff-generator.ts`
- Function: `logDiff(diff: CoverageDiff, trigger: string): Promise<void>`

**Refactor (REFACTOR step):**
- [ ] Add log rotation

**Acceptance Criteria:**
- [ ] All logging tests pass

---

## Phase 6: Build Pre-flight Integration

### Task 6.1: Implement Pre-flight Check

**Objective:** Run spec check before build starts

**Tests to Write (RED step):**
- [ ] Test: `runPreflightCheck() returns drift report`
  - File: `test/services/build-preflight.test.ts`
  - Assertion: Returns PreflightReport with drifts array
- [ ] Test: `runPreflightCheck() returns coverage summary`
  - File: `test/services/build-preflight.test.ts`
  - Assertion: PreflightReport has coverage field
- [ ] Test: `runPreflightCheck() returns 'pass' when no drift`
  - File: `test/services/build-preflight.test.ts`
  - Assertion: status: 'pass'
- [ ] Test: `runPreflightCheck() returns 'drift_detected' when drift found`
  - File: `test/services/build-preflight.test.ts`
  - Assertion: status: 'drift_detected'

**Implementation (GREEN step):**
- File: `src/services/build-preflight.ts`
- Function: `runPreflightCheck(feature: string): Promise<PreflightReport>`

**Refactor (REFACTOR step):**
- [ ] Add caching for recent checks

**Acceptance Criteria:**
- [ ] All pre-flight check tests pass

---

### Task 6.2: Implement User Choice Handler

**Objective:** Handle user response to drift (fix/proceed/update)

**Tests to Write (RED step):**
- [ ] Test: `handleUserChoice('fix') queues reconciliation tasks`
  - File: `test/services/build-preflight.test.ts`
  - Assertion: Reconciler called with drifts
- [ ] Test: `handleUserChoice('proceed') logs accepted drift`
  - File: `test/services/build-preflight.test.ts`
  - Assertion: Log entry with type 'drift_accepted'
- [ ] Test: `handleUserChoice('update') modifies spec file`
  - File: `test/services/build-preflight.test.ts`
  - Assertion: Spec file updated to match code
- [ ] Test: `handleUserChoice() returns action result`
  - File: `test/services/build-preflight.test.ts`
  - Assertion: { action, success, details }

**Implementation (GREEN step):**
- File: `src/services/build-preflight.ts`
- Function: `handleUserChoice(choice: 'fix' | 'proceed' | 'update', report: PreflightReport): Promise<ChoiceResult>`

**Refactor (REFACTOR step):**
- [ ] Add confirmation step for destructive actions

**Acceptance Criteria:**
- [ ] All choice handler tests pass

---

## Phase 7: WatcherSupervisor Integration

### Task 7.1: Register SpecMonitor with Supervisor

**Objective:** Add SpecMonitor to WatcherSupervisor

**Tests to Write (RED step):**
- [ ] Test: `WatcherSupervisor creates SpecMonitor on init`
  - File: `test/supervisor/watcher-supervisor-spec.test.ts`
  - Assertion: this.specMonitor is defined
- [ ] Test: `WatcherSupervisor starts spec monitoring interval`
  - File: `test/supervisor/watcher-supervisor-spec.test.ts`
  - Assertion: Interval registered with correct period

**Implementation (GREEN step):**
- File: `src/supervisor/watcher-supervisor.ts`
- Add to constructor: Create SpecMonitor instance
- Add method: `startSpecMonitoring(intervalMs: number): void`

**Refactor (REFACTOR step):**
- [ ] Add enable/disable toggle

**Acceptance Criteria:**
- [ ] All integration tests pass

---

### Task 7.2: Add Spec Healthcheck

**Objective:** Add spec-sync healthcheck to healthcheck service

**Tests to Write (RED step):**
- [ ] Test: `specHealthcheck returns 'pass' when coverage > 80%`
  - File: `test/services/healthcheck.test.ts`
  - Assertion: status: 'pass'
- [ ] Test: `specHealthcheck returns 'warn' when coverage 50-80%`
  - File: `test/services/healthcheck.test.ts`
  - Assertion: status: 'warn'
- [ ] Test: `specHealthcheck returns 'fail' when coverage < 50%`
  - File: `test/services/healthcheck.test.ts`
  - Assertion: status: 'fail'
- [ ] Test: `specHealthcheck returns 'fail' when drift count > 5`
  - File: `test/services/healthcheck.test.ts`
  - Assertion: status: 'fail'

**Implementation (GREEN step):**
- File: `src/services/healthcheck.ts`
- Add check: `specHealthcheck(): Promise<HealthcheckResult>`

**Refactor (REFACTOR step):**
- [ ] Add configurable thresholds

**Acceptance Criteria:**
- [ ] All healthcheck tests pass

---

## Testing Strategy

### Unit Tests
- [ ] All parser functions (7 tests)
- [ ] All drift detection methods (12 tests)
- [ ] All reconciliation methods (10 tests)
- [ ] All metrics methods (8 tests)
- [ ] All diff generator methods (6 tests)
- [ ] All build preflight methods (6 tests)

### Integration Tests
- [ ] SpecMonitor full scan cycle
- [ ] Reconciliation with real file modifications
- [ ] Metrics persistence across restarts
- [ ] Pre-flight check with real spec files

### Edge Cases
- [ ] Empty spec files
- [ ] Malformed markers
- [ ] Missing .oss/dev/active/ directory
- [ ] Concurrent file access
- [ ] Very large spec files

---

## Security Checklist

- [ ] No file path injection (validate paths are within project)
- [ ] No arbitrary file modification (only spec files in .oss/)
- [ ] Audit trail for all auto-fix actions
- [ ] Rate limiting on LLM calls (if behavioral analysis added)

---

## Performance Considerations

- [ ] Cache parsed specs (TTL 5 minutes)
- [ ] Limit file glob scope to relevant directories
- [ ] Batch file reads for coverage calculation
- [ ] Lazy load metrics file

---

## Rollout Strategy

- [ ] Feature flag: `spec_sync_enabled` in config
- [ ] Gradual rollout: Start with structural detection only
- [ ] Full rollout: Add behavioral + criteria detection
- [ ] Monitoring: Track false positive rate

---

## Summary

| Phase | Tasks | Tests |
|-------|-------|-------|
| 1. Core Types & Parser | 3 | 12 |
| 2. SpecMonitor | 5 | 16 |
| 3. SpecReconciler | 4 | 14 |
| 4. SpecMetrics | 4 | 10 |
| 5. Diff Generator | 3 | 8 |
| 6. Build Pre-flight | 2 | 8 |
| 7. Supervisor Integration | 2 | 6 |
| **Total** | **23** | **74** |

---

*Plan created: 2026-01-16*
*Status: Ready for /oss:build*
