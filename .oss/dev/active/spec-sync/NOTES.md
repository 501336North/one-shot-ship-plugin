# Implementation Notes: Spec Sync Daemon

## Key Files to Create

```
watcher/src/
├── monitors/
│   └── spec-monitor.ts              # NEW
├── services/
│   ├── spec-reconciler/
│   │   ├── index.ts                 # NEW - Reconciler orchestrator
│   │   ├── types.ts                 # NEW - Spec types
│   │   ├── parser.ts                # NEW - Marker parser
│   │   ├── file-matcher.ts          # NEW - Component-to-file matcher
│   │   ├── auto-fixer.ts            # NEW - Auto-fix logic
│   │   └── diff-generator.ts        # NEW - Diff generation
│   ├── spec-metrics.ts              # NEW - Metrics service
│   └── build-preflight.ts           # NEW - Pre-flight check
```

## Existing Code Patterns to Follow

### Monitor Pattern (from log-monitor.ts)
```typescript
export class SpecMonitor {
  private readonly queueManager: QueueManager;

  constructor(queueManager: QueueManager) {
    this.queueManager = queueManager;
  }

  async emitAnomaly(drift: DriftResult): Promise<void> {
    const task: CreateTaskInput = {
      priority: 'high',
      source: 'spec-monitor',
      anomaly_type: 'unusual_pattern',
      prompt: `Spec drift: ${drift.description}`,
      suggested_agent: 'debugger',
      context: { type: drift.type }
    };
    await this.queueManager.addTask(task);
  }

  reset(): void {
    // Clear state
  }
}
```

### Type Updates Needed

Add to `watcher/src/types.ts`:
```typescript
// Add to MonitorSource union
export type MonitorSource =
  | 'log-monitor'
  | 'test-monitor'
  | 'git-monitor'
  | 'spec-monitor'  // NEW
  | 'iron-law-monitor'
  | 'manual';
```

## Spec Marker Format

```markdown
<!-- spec:components -->
- [ ] ComponentName - Description
- [x] AnotherComponent - Already implemented
<!-- /spec:components -->

<!-- spec:criteria -->
- [ ] SC-001: Description of criterion
<!-- /spec:criteria -->

<!-- spec:behaviors -->
- Behavior description in prose
<!-- /spec:behaviors -->
```

## Regex Patterns for Parser

```typescript
const MARKER_PATTERN = /<!-- spec:(\w+) -->([\s\S]*?)<!-- \/spec:\1 -->/g;
const CHECKBOX_PATTERN = /^- \[([ x])\] (.+)$/gm;
const CRITERION_PATTERN = /^- \[([ x])\] (SC-\d+): (.+)$/gm;
```

## Metrics File Location

`.oss/spec-metrics.json` (project-local, not global)

## Integration Points

1. **WatcherSupervisor** - Add SpecMonitor to constructor
2. **HealthcheckService** - Add specHealthcheck method
3. **Build prompt** - Add pre-flight check step

## Gotchas

- Don't modify files outside .oss/ directory
- Handle missing .oss/dev/active/ gracefully
- Spec files may not exist yet for new features
- Rate limit LLM calls if behavioral analysis added

## Last Updated: 2026-01-16 20:45 by /oss:plan
