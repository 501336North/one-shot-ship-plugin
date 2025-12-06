# OSS Watcher - Supervisor Agent System

Real-time workflow monitoring and intervention system for One Shot Ship.

## Overview

The Watcher is a supervisor agent that monitors workflow logs and intervenes when issues are detected. It provides observability into agent work and enables self-healing workflows.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     WATCHER SUPERVISOR SYSTEM                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   .oss/workflow.log          WatcherSupervisor                       │
│   ┌──────────────┐           ┌─────────────────────────────────┐    │
│   │ {"cmd":"build│           │                                 │    │
│   │  "event":... │──tail────▶│  LogReader (real-time tailing) │    │
│   │ }            │           │           │                     │    │
│   │ # BUILD:...  │           │           ▼                     │    │
│   └──────────────┘           │  WorkflowAnalyzer (reasoning)   │    │
│                              │           │                     │    │
│                              │           ▼                     │    │
│                              │  InterventionGenerator          │    │
│                              │           │                     │    │
│                              │           ▼                     │    │
│                              │  ┌─────────────────────┐        │    │
│                              │  │ Response Actions:   │        │    │
│                              │  │ • auto_remediate    │        │    │
│                              │  │ • notify_suggest    │        │    │
│                              │  │ • notify_only       │        │    │
│                              │  └─────────────────────┘        │    │
│                              └─────────────────────────────────┘    │
│                                          │                           │
│                                          ▼                           │
│                              ┌─────────────────────────────────┐    │
│                              │       QueueManager               │    │
│                              │  .oss/queue.json                 │    │
│                              │  - Tasks for investigation       │    │
│                              │  - Prioritized by severity       │    │
│                              └─────────────────────────────────┘    │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. WorkflowLogger (`src/logger/workflow-logger.ts`)
Appends structured log entries to `.oss/workflow.log`.

```typescript
import { WorkflowLogger } from './logger/workflow-logger.js';

const logger = new WorkflowLogger('/path/to/.oss');

// Log events
await logger.log({
  cmd: 'build',
  event: 'START',
  data: { plan_ref: 'dev/active/auth/PLAN.md' }
});

await logger.log({
  cmd: 'build',
  event: 'MILESTONE',
  data: { task: 1, phase: 'red', test: 'should validate email' }
});
```

**Log Format:** Hybrid JSON + human-readable
```
{"ts":"2025-12-07T01:30:00.000Z","cmd":"build","event":"START","data":{...}}
# BUILD:START - Executing TDD plan
```

### 2. LogReader (`src/logger/log-reader.ts`)
Reads and tails the workflow log with query capabilities.

```typescript
import { LogReader } from './logger/log-reader.js';

const reader = new LogReader('/path/to/.oss');

// Read all entries
const entries = await reader.readAll();

// Query specific entries
const lastPlan = await reader.queryLast({ cmd: 'plan', event: 'COMPLETE' });

// Real-time tailing
reader.startTailing((entry) => {
  console.log('New entry:', entry);
});
```

### 3. WorkflowAnalyzer (`src/analyzer/workflow-analyzer.ts`)
Semantic reasoning engine that detects workflow issues.

**Detects:**

| Category | Issues |
|----------|--------|
| **Negative Signals** | Loops, failures, TDD violations, regressions |
| **Positive Signal Erosion** | Silence, missing milestones, declining velocity |
| **Hard Stops** | Abrupt stop, partial completion, abandoned agents |

```typescript
import { WorkflowAnalyzer } from './analyzer/workflow-analyzer.js';

const analyzer = new WorkflowAnalyzer();
const analysis = analyzer.analyze(entries);

console.log(analysis.issues);       // Detected problems
console.log(analysis.chain_progress); // ideate/plan/build/ship status
console.log(analysis.health_score);   // 0-100 health rating
```

### 4. InterventionGenerator (`src/intervention/generator.ts`)
Creates interventions based on issue confidence levels.

| Confidence | Response Type | Action |
|------------|---------------|--------|
| > 0.9 | `auto_remediate` | Automatic fix (kill process, suggest recovery) |
| 0.7 - 0.9 | `notify_suggest` | Notify user with suggested action |
| < 0.7 | `notify_only` | Just notify, no action suggested |

```typescript
import { InterventionGenerator } from './intervention/generator.js';

const generator = new InterventionGenerator();
const intervention = generator.generate(issue);

console.log(intervention.response_type);  // 'auto_remediate'
console.log(intervention.notification);   // { title, message, sound }
console.log(intervention.queue_task);     // Task for queue if needed
```

### 5. WatcherSupervisor (`src/supervisor/watcher-supervisor.ts`)
Orchestrates the entire monitoring system.

```typescript
import { WatcherSupervisor } from './supervisor/watcher-supervisor.js';
import { QueueManager } from './queue/manager.js';

const queueManager = new QueueManager('/path/to/.oss');
const supervisor = new WatcherSupervisor('/path/to/.oss', queueManager);

// Register callbacks
supervisor.onAnalyze((analysis, entries) => {
  console.log('Analysis:', analysis.health_score);
});

supervisor.onIntervention((intervention) => {
  console.log('Intervention:', intervention.response_type);
});

supervisor.onNotify((title, message) => {
  // Send macOS notification
  exec(`terminal-notifier -title "${title}" -message "${message}"`);
});

// Start monitoring
await supervisor.start();

// ... later
await supervisor.stop();
```

### 6. QueueManager (`src/queue/manager.ts`)
Manages investigation tasks generated by interventions.

```typescript
import { QueueManager } from './queue/manager.js';

const queue = new QueueManager('/path/to/.oss');
await queue.initialize();

// Add task
await queue.addTask({
  priority: 'high',
  source: 'log-monitor',
  anomaly_type: 'agent_loop',
  prompt: 'Investigate loop in build task 3',
  suggested_agent: 'debugger'
});

// Get tasks
const tasks = await queue.getTasks();
const nextTask = await queue.getNextTask();

// Complete task
await queue.completeTask(taskId, { resolution: 'Fixed import path' });
```

## Issue Types

The analyzer detects these issue types:

| Issue Type | Description | Typical Confidence |
|------------|-------------|-------------------|
| `loop_detected` | Same action repeated 3+ times | 0.85 - 0.95 |
| `explicit_failure` | FAILED event in log | 0.95 |
| `phase_stuck` | No progress for >4 minutes | 0.75 - 0.90 |
| `silence` | No activity for >90 seconds | 0.70 - 0.85 |
| `tdd_violation` | Code without test | 0.90 |
| `out_of_order` | Commands in wrong sequence | 0.80 |
| `missing_milestones` | Expected milestones not hit | 0.75 |
| `abrupt_stop` | Started but never completed | 0.85 |
| `abandoned_agent` | Spawned agent never reported back | 0.80 |
| `declining_velocity` | Milestone rate slowing down | 0.65 |

## State Persistence

The supervisor maintains state in `.oss/workflow-state.json`:

```json
{
  "current_command": "build",
  "current_phase": "green",
  "chain_progress": {
    "ideate": "complete",
    "plan": "complete",
    "build": "in_progress",
    "ship": "pending"
  },
  "milestone_timestamps": ["2025-12-07T01:30:00Z", "..."],
  "last_activity_time": "2025-12-07T01:35:00Z"
}
```

State is:
- Loaded on supervisor start
- Rebuilt from log if state file missing
- Saved after every entry processed

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- watcher-supervisor.test.ts

# Run with coverage
npm test -- --coverage
```

**Test Coverage: 253 tests**

| Test File | Tests |
|-----------|-------|
| workflow-logger.test.ts | 13 |
| log-reader.test.ts | 14 |
| workflow-analyzer.test.ts | 31 |
| intervention-generator.test.ts | 14 |
| watcher-supervisor.test.ts | 10 |
| supervisor-e2e.test.ts | 6 |
| queue-manager.test.ts | 31 |
| rule-engine.test.ts | 35 |
| (other monitors) | 99 |

## Integration with Commands

Each `/oss:*` command logs to the workflow:

| Command | Events Logged |
|---------|---------------|
| `/oss:ideate` | START, MILESTONE (problem_definition, solution_design, approach_selected), COMPLETE |
| `/oss:plan` | START, MILESTONE (context_gathering, task_breakdown, sequencing), COMPLETE |
| `/oss:build` | START, MILESTONE per task (red/green/refactor), AGENT_SPAWN, COMPLETE |
| `/oss:ship` | START, AGENT_SPAWN (4 quality agents), AGENT_COMPLETE, MILESTONE (gates), COMPLETE |

## Files

```
watcher/
├── src/
│   ├── logger/
│   │   ├── workflow-logger.ts   # Writes structured logs
│   │   └── log-reader.ts        # Reads and tails logs
│   ├── analyzer/
│   │   └── workflow-analyzer.ts # Semantic issue detection
│   ├── intervention/
│   │   └── generator.ts         # Creates interventions
│   ├── supervisor/
│   │   └── watcher-supervisor.ts # Orchestrates everything
│   ├── queue/
│   │   └── manager.ts           # Task queue management
│   └── types.ts                 # TypeScript types
├── test/
│   ├── workflow-logger.test.ts
│   ├── log-reader.test.ts
│   ├── workflow-analyzer.test.ts
│   ├── intervention-generator.test.ts
│   ├── watcher-supervisor.test.ts
│   └── supervisor-e2e.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## The Two Pillars of Observability

This system works alongside dev docs:

| System | Purpose | Who Uses It |
|--------|---------|-------------|
| **Dev Docs** (`dev/active/`) | Keep work moving forward | Current agent (continuity) |
| **Workflow Logs** (`.oss/`) | Detect and correct problems | Watcher supervisor (intervention) |

**Dev docs = continuity. Logs = correction.**

Together they make agents self-healing and resilient.

---

*Part of the One Shot Ship workflow system.*
