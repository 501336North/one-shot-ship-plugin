# Feature: Spec Sync Daemon

## Problem

Currently, the watcher supervisor monitors *workflow execution* (phases, milestones, loops, hung processes) but has no visibility into whether **what was built matches what was designed**.

This creates several risks:
- **Silent drift** - Code evolves away from spec without anyone noticing
- **Incomplete implementation** - Features partially built, spec items forgotten
- **Gold-plating** - Developers add unplanned features, increasing complexity
- **Long-term entropy** - Over weeks, the gap between spec and code widens

**Who has this problem?**
- Developers who want confidence their implementation matches the plan
- Teams needing audit trails of spec-to-code alignment
- The watcher supervisor which currently can't detect specification drift

## Solution

A **Spec Sync System** with three components:

1. **SpecMonitor** - New parallel monitor in WatcherSupervisor that continuously scans for drift between feature specs (DESIGN.md, PLAN.md) and actual code

2. **SpecReconciler** - Agent/service that can auto-fix simple drifts and generate remediation tasks for complex ones

3. **SpecMetrics** - Long-term tracking of spec coverage, drift velocity, and reconciliation history

### Integration Points

| Touch Point | What Happens |
|-------------|--------------|
| `/oss:build` pre-flight | Runs reconciliation check before build starts, prompts on drift |
| WatcherSupervisor | SpecMonitor runs alongside LogMonitor, TestMonitor, GitMonitor |
| Queue system | Drift issues create queue tasks like other anomalies |
| Healthcheck | New "spec-sync" healthcheck for spec staleness and drift |
| Status line | Shows spec coverage and drift status |

## Approach

### Hybrid Spec Parsing

**Structured Layer (Deterministic)** - Parseable markers for reliable extraction:

```markdown
# Feature: User Authentication

## Components
<!-- spec:components -->
- [ ] AuthService - Handles login/logout logic
- [ ] UserRepository - Database access for users
- [ ] JWTProvider - Token generation and validation
- [x] PasswordHasher - Bcrypt password hashing
<!-- /spec:components -->

## Success Criteria
<!-- spec:criteria -->
- [ ] SC-001: Users can register with email/password
- [ ] SC-002: Users can login and receive JWT
- [x] SC-003: Passwords are hashed with bcrypt
<!-- /spec:criteria -->

## Behaviors
<!-- spec:behaviors -->
- Email format validation required before registration
- JWT expires after 24 hours
- Failed login attempts are rate-limited
<!-- /spec:behaviors -->
```

**Semantic Layer (LLM)** - For behavioral understanding:
- Map prose behaviors to code patterns
- Detect behavioral drift (e.g., "JWT expires after 24 hours" → check for `expiresIn: '24h'`)
- Identify scope creep (code doing things not mentioned in spec)

### Drift Types Detected

| Type | Detection Method | Example |
|------|------------------|---------|
| `structural_missing` | Component in spec, no matching file | "AuthService" in spec, no `auth-service.ts` |
| `structural_extra` | File exists, not in spec | `analytics.ts` exists, not in DESIGN.md |
| `behavioral_mismatch` | LLM detects implementation differs | Spec says "24h JWT", code uses "1h" |
| `criteria_incomplete` | Success criterion unchecked, no test | SC-002 unchecked, no test for login |

### Reconciliation Flow

```
Drift Detected
     │
     ▼
┌─────────────────┐
│ Classify Drift  │
│ (simple/complex)│
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
 Simple    Complex
    │         │
    ▼         ▼
Auto-fix   Queue Task
    │      (human review)
    ▼         │
Log action    ▼
    │      Notify via
    ▼      status line
Update
metrics
```

**Auto-fixable drifts (high confidence >0.9):**

| Drift | Auto-fix Action |
|-------|-----------------|
| Unchecked component, file exists | Check the box in spec `- [x]` |
| Missing test for checked criterion | Generate test stub, queue for implementation |
| Spec file missing in new feature | Generate template from DESIGN.md pattern |

**Human-review drifts (confidence <0.9):**

| Drift | Queue Task |
|-------|------------|
| Behavioral mismatch | "Review: JWT expiry differs from spec" |
| Scope creep detected | "Review: Unspecified code in {file}" |
| Major structural gap | "Implement: {Component} missing per DESIGN.md" |

## Components

### 1. SpecMonitor (`watcher/src/monitors/spec-monitor.ts`)

| Function | Description |
|----------|-------------|
| `scanActiveFeatures()` | Find all `.oss/dev/active/{feature}/` directories |
| `parseSpec(feature)` | Extract structured markers from DESIGN.md/PLAN.md |
| `detectDrift(feature)` | Compare spec items to codebase, identify gaps |
| `calculateCoverage(feature)` | Compute spec coverage ratio |
| `emitDriftAnomaly(drift)` | Create queue task for detected drift |

**Scan interval:** Every 5 minutes (configurable via `spec.scanIntervalMs`)

### 2. SpecReconciler (`watcher/src/services/spec-reconciler/`)

```
watcher/src/services/spec-reconciler/
├── index.ts              # Main reconciler orchestrator
├── parser.ts             # Structured marker extraction
├── analyzer.ts           # LLM-based behavioral analysis
├── diff-generator.ts     # Generate spec diffs on code changes
└── auto-fixer.ts         # Auto-remediation for simple drifts
```

### 3. SpecMetrics (`.oss/spec-metrics.json`)

```json
{
  "version": "1.0",
  "updated_at": "2026-01-16T20:30:00Z",
  "features": {
    "user-auth": {
      "spec_path": ".oss/dev/active/user-auth/DESIGN.md",
      "coverage": {
        "components": { "total": 4, "implemented": 3, "ratio": 0.75 },
        "criteria": { "total": 5, "satisfied": 4, "ratio": 0.80 },
        "behaviors": { "total": 3, "verified": 2, "ratio": 0.67 }
      },
      "drift": {
        "current_count": 2,
        "types": ["structural_missing", "behavioral_mismatch"]
      },
      "history": [
        { "date": "2026-01-10", "coverage": 0.50, "drift_count": 5 },
        { "date": "2026-01-12", "coverage": 0.65, "drift_count": 3 },
        { "date": "2026-01-16", "coverage": 0.75, "drift_count": 2 }
      ]
    }
  },
  "reconciliations": [
    {
      "timestamp": "2026-01-15T14:30:00Z",
      "feature": "user-auth",
      "drift_type": "structural_missing",
      "action": "auto_fixed",
      "details": "Checked PasswordHasher component in DESIGN.md"
    }
  ],
  "velocity": {
    "weekly_drift_avg": 2.5,
    "weekly_reconciliations": 8,
    "trend": "improving"
  }
}
```

**Metrics tracked:**

| Metric | Description |
|--------|-------------|
| `spec_coverage` | % of spec items implemented |
| `drift_count` | Current unresolved drifts |
| `drift_velocity` | Rate of drift accumulation (weekly) |
| `reconciliation_rate` | How quickly drifts are fixed |
| `history` | Coverage over time (daily snapshots) |

### 4. Build Pre-flight Integration

Before `/oss:build` executes the TDD plan:

```
┌─────────────────────────────────────────────────────────────┐
│  /oss:build - Pre-flight Spec Check                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Checking spec alignment for: user-auth                     │
│                                                              │
│  ✓ Components: 3/4 implemented (75%)                        │
│  ✓ Criteria: 4/5 satisfied (80%)                            │
│  ⚠ Behaviors: 2/3 verified (67%)                            │
│                                                              │
│  ┌─ Drift Detected ─────────────────────────────────────┐   │
│  │ 1. STRUCTURAL: JWTProvider not found in codebase     │   │
│  │ 2. BEHAVIORAL: JWT expiry set to 1h, spec says 24h   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  How would you like to proceed?                             │
│                                                              │
│  [1] Fix now - Address drift before building                │
│  [2] Proceed anyway - Build with known drift                │
│  [3] Update spec - Change spec to match current code        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5. Spec Diff Generation

On code changes, generate spec impact analysis:

```
┌─────────────────────────────────────────────────────────────┐
│  Spec Diff: user-auth (triggered by src/auth-service.ts)   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  File changed: src/auth-service.ts                          │
│  Related spec: .oss/dev/active/user-auth/DESIGN.md          │
│                                                              │
│  Coverage Impact:                                            │
│  - Components: 75% → 75% (no change)                        │
│  + Criteria: 80% → 100% (SC-002 now satisfied)              │
│  - Behaviors: 67% → 67% (no change)                         │
│                                                              │
│  Drift Changes:                                              │
│  - RESOLVED: "Login endpoint missing" (was structural)      │
│  + NEW: "Rate limiting not implemented" (behavioral)        │
│                                                              │
│  Net: Coverage ↑5%, Drift count unchanged (1 fixed, 1 new)  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Triggers:**
- File in feature scope modified → Generate diff, log to workflow.log
- Git commit in feature branch → Snapshot coverage, compare to previous
- Manual `/oss:spec-check` command → Full reconciliation report

## Success Criteria

| # | Criterion | Verification |
|---|-----------|--------------|
| SC-001 | SpecMonitor detects structural drift (missing component) | Test: Add component to spec, verify drift detected |
| SC-002 | SpecMonitor detects behavioral drift (implementation mismatch) | Test: Change code behavior, verify LLM identifies mismatch |
| SC-003 | SpecMonitor detects scope drift (unspecified code) | Test: Add file not in spec, verify flagged as extra |
| SC-004 | Auto-reconciliation fixes simple drifts | Test: Missing checkbox, verify auto-checked |
| SC-005 | Complex drifts create queue tasks | Test: Behavioral drift, verify task in queue.json |
| SC-006 | `/oss:build` pre-flight shows drift report | Test: Run build with drift, verify prompt appears |
| SC-007 | User can choose fix/proceed/update in pre-flight | Test: Each option works correctly |
| SC-008 | Metrics track coverage over time | Test: Coverage history grows with each scan |
| SC-009 | Drift velocity calculated weekly | Test: Velocity computed from history data |
| SC-010 | Spec diffs generated on code changes | Test: Modify file, verify diff logged |

## TDD Test Plan

**Phase 1: SpecMonitor (Core Detection)**
```
1. spec-monitor.test.ts
   - scanActiveFeatures() finds all .oss/dev/active/{feature}/ dirs
   - parseSpec() extracts components from <!-- spec:components --> markers
   - parseSpec() extracts criteria from <!-- spec:criteria --> markers
   - parseSpec() extracts behaviors from <!-- spec:behaviors --> markers
   - detectDrift() returns structural_missing when component file absent
   - detectDrift() returns structural_extra when file not in spec
   - calculateCoverage() computes correct ratio
   - emitDriftAnomaly() creates queue task with correct format
```

**Phase 2: SpecReconciler (Auto-fix & Queue)**
```
2. spec-reconciler.test.ts
   - classifyDrift() returns "simple" for checkbox updates
   - classifyDrift() returns "complex" for behavioral mismatches
   - autoFix() checks unchecked component when file exists
   - autoFix() generates test stub for missing criterion test
   - queueTask() creates task with correct anomaly_type
   - queueTask() assigns appropriate suggested_agent
```

**Phase 3: SpecMetrics (Tracking)**
```
3. spec-metrics.test.ts
   - updateCoverage() calculates correct ratios
   - recordHistory() appends daily snapshot
   - calculateVelocity() computes weekly drift average
   - recordReconciliation() adds to audit trail
```

**Phase 4: Build Integration**
```
4. build-preflight.test.ts
   - runPreflightCheck() returns drift report
   - handleUserChoice("fix") queues reconciliation tasks
   - handleUserChoice("proceed") logs accepted drift
   - handleUserChoice("update") modifies spec file
```

**Phase 5: Diff Generation**
```
5. diff-generator.test.ts
   - onFileChange() generates coverage diff
   - onFileChange() identifies resolved drifts
   - onFileChange() identifies new drifts
   - logDiff() appends to spec-diffs.log
```

## Out of Scope

| Excluded | Reason |
|----------|--------|
| Prompt version tracking | Different system (API prompts vs feature specs) |
| API schema validation | Could be future enhancement, not core to feature specs |
| Real-time file watching | Using periodic scan (5min) to avoid complexity |
| Multi-repo spec sync | Focused on single repo `.oss/dev/active/` |
| Spec generation from code | One-way: spec → code validation only |
| CI/CD integration | Watcher runs locally, not in CI pipelines |
| Visual diff UI | CLI output only, no web dashboard |

---

*Design created: 2026-01-16*
*Status: Ready for /oss:plan*
