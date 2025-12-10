# Data Model: Supervisor Agent with Structured Logging

## Core Types

### WorkflowLogEntry

```typescript
interface WorkflowLogEntry {
  // Timestamp in ISO 8601 format
  ts: string;

  // Command that generated this entry
  cmd: string;  // e.g., "build", "plan", "ideate"

  // Phase within the command (optional)
  phase?: string;  // e.g., "RED", "GREEN", "REFACTOR"

  // Event type
  event: WorkflowEvent;

  // Event-specific data
  data: Record<string, unknown>;

  // Agent info if this is from a spawned agent
  agent?: {
    type: string;      // e.g., "test-engineer"
    id: string;        // unique agent instance ID
    parent_cmd: string; // command that spawned this agent
  };
}

type WorkflowEvent =
  | 'START'
  | 'PHASE_START'
  | 'PHASE_COMPLETE'
  | 'MILESTONE'
  | 'AGENT_SPAWN'
  | 'AGENT_COMPLETE'
  | 'COMPLETE'
  | 'FAILED';
```

### Log Entry Data by Event Type

```typescript
// START event data
interface StartData {
  args?: string[];           // command arguments
  context?: string;          // what triggered this command
}

// PHASE_START / PHASE_COMPLETE data
interface PhaseData {
  phase: string;
  details?: string;
}

// MILESTONE data
interface MilestoneData {
  description: string;
  metrics?: Record<string, number>;  // e.g., { tests_written: 3 }
}

// AGENT_SPAWN data
interface AgentSpawnData {
  agent_type: string;
  agent_id: string;
  task: string;
}

// AGENT_COMPLETE data
interface AgentCompleteData {
  agent_type: string;
  agent_id: string;
  status: 'success' | 'failed';
  result?: string;
  error?: string;
}

// COMPLETE data
interface CompleteData {
  summary: string;
  outputs?: string[];        // files created
  metrics?: Record<string, number>;
  next_suggested?: string;   // suggested next command
}

// FAILED data
interface FailedData {
  error: string;
  phase?: string;            // phase where failure occurred
  recoverable: boolean;
  suggestion?: string;
}
```

### WorkflowAnalysis

```typescript
interface WorkflowAnalysis {
  // Current workflow state
  current_command?: string;
  current_phase?: string;
  phase_start_time?: string;

  // Health assessment
  health: 'healthy' | 'warning' | 'critical';

  // Detected issues
  issues: WorkflowIssue[];

  // Chain progress
  chain_position: number;    // 0=ideate, 1=plan, 2=build, 3=ship
  chain_complete: boolean;
}

interface WorkflowIssue {
  type: IssueType;
  confidence: number;        // 0.0 to 1.0
  description: string;
  evidence: string[];        // log entries that support this
  suggested_action: string;
  auto_remediable: boolean;
}

type IssueType =
  | 'loop_detected'
  | 'phase_stuck'
  | 'regression'
  | 'out_of_order'
  | 'agent_failed'
  | 'tdd_violation'
  | 'chain_broken';
```

### Intervention

```typescript
interface Intervention {
  // From analysis
  issue: WorkflowIssue;

  // Response decision
  response_type: 'auto_remediate' | 'notify_suggest' | 'notify_only';

  // Queue task (if response requires action)
  queue_task?: {
    priority: Priority;
    prompt: string;
    suggested_agent: string;
    context: TaskContext;
  };

  // Notification (if response includes notification)
  notification?: {
    title: string;
    message: string;
    sound: 'default' | 'Basso' | 'Glass';
  };
}
```

## File Formats

### .oss/workflow.log

Hybrid format: JSON line followed by human-readable summary

```
{"ts":"2025-12-07T01:00:00Z","cmd":"ideate","event":"START","data":{"args":["supervisor agent"]}}
# IDEATE:START - Beginning ideation for "supervisor agent"

{"ts":"2025-12-07T01:15:00Z","cmd":"ideate","event":"COMPLETE","data":{"summary":"Design brief created","outputs":["dev/active/supervisor/DESIGN.md"],"next_suggested":"plan"}}
# IDEATE:COMPLETE - Design brief created, next: /oss:plan

{"ts":"2025-12-07T01:16:00Z","cmd":"plan","event":"START","data":{}}
# PLAN:START - Creating TDD implementation plan

{"ts":"2025-12-07T01:20:00Z","cmd":"plan","phase":"ANALYSIS","event":"PHASE_START","data":{}}
# PLAN:ANALYSIS:START - Analyzing requirements

{"ts":"2025-12-07T01:25:00Z","cmd":"plan","event":"AGENT_SPAWN","data":{"agent_type":"backend-architect","agent_id":"ba-001","task":"Design logging architecture"}}
# PLAN:AGENT_SPAWN - Spawning backend-architect for logging architecture

{"ts":"2025-12-07T01:25:01Z","cmd":"plan","agent":{"type":"backend-architect","id":"ba-001","parent_cmd":"plan"},"event":"START","data":{}}
# AGENT:backend-architect:START - Beginning architecture analysis

{"ts":"2025-12-07T01:28:00Z","cmd":"plan","agent":{"type":"backend-architect","id":"ba-001","parent_cmd":"plan"},"event":"COMPLETE","data":{"summary":"Recommended append-only log with atomic writes"}}
# AGENT:backend-architect:COMPLETE - Recommended append-only log with atomic writes

{"ts":"2025-12-07T01:28:01Z","cmd":"plan","event":"AGENT_COMPLETE","data":{"agent_type":"backend-architect","agent_id":"ba-001","status":"success"}}
# PLAN:AGENT_COMPLETE - backend-architect completed successfully
```

### .oss/workflow-state.json

Current workflow state (updated by watcher)

```json
{
  "version": "1.0",
  "updated_at": "2025-12-07T01:28:01Z",
  "current": {
    "command": "plan",
    "phase": "ANALYSIS",
    "started_at": "2025-12-07T01:16:00Z",
    "phase_started_at": "2025-12-07T01:20:00Z"
  },
  "chain": {
    "ideate": { "status": "complete", "completed_at": "2025-12-07T01:15:00Z" },
    "plan": { "status": "in_progress", "started_at": "2025-12-07T01:16:00Z" },
    "build": { "status": "pending" },
    "ship": { "status": "pending" }
  },
  "health": "healthy",
  "active_agents": [
    { "type": "backend-architect", "id": "ba-001", "started_at": "2025-12-07T01:25:01Z" }
  ]
}
```

## Constants

```typescript
// Phase timeout thresholds (seconds)
const PHASE_TIMEOUTS: Record<string, number> = {
  // TDD phases
  'RED': 600,        // 10 min - writing tests takes time
  'GREEN': 300,      // 5 min
  'REFACTOR': 180,   // 3 min

  // Command phases
  'ANALYSIS': 300,
  'GENERATION': 600,
  'VALIDATION': 180,

  // Default
  'DEFAULT': 300,
};

// Loop detection threshold
const LOOP_THRESHOLD = 3;  // same action 3+ times

// Confidence thresholds for response type
const CONFIDENCE_AUTO_REMEDIATE = 0.9;
const CONFIDENCE_SUGGEST = 0.7;

// Command chain order
const COMMAND_CHAIN = ['ideate', 'plan', 'build', 'ship'];
```
