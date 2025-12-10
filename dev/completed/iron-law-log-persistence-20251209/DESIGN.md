# Design: IRON LAW PRE-CHECK Log Persistence

## Overview

Add persistent logging for IRON LAW compliance checks so they appear in:
1. Unified session log (`~/.oss/logs/current-session/session.log`)
2. Command-specific logs (`~/.oss/logs/current-session/{command}.log`)

## Current Architecture

```
┌─────────────────────────────┐
│  oss-iron-law-check.sh     │
│  (UserPromptSubmit hook)    │
│                             │
│  Outputs to: stdout         │ ──→ system-reminder (shown to user)
│  Persists to: (nothing)     │
└─────────────────────────────┘
```

## Proposed Architecture

```
┌─────────────────────────────┐
│  oss-iron-law-check.sh     │
│  (UserPromptSubmit hook)    │
│                             │
│  Outputs to: stdout         │ ──→ system-reminder (shown to user)
│                             │
│  Calls: oss-log.sh ironlaw  │ ──→ session.log + command.log
└─────────────────────────────┘
                │
                ▼
┌─────────────────────────────┐
│  oss-log.sh ironlaw        │
│                             │
│  Writes structured entry:   │
│  [HH:MM:SS] [cmd] [IRON_LAW]│
│  STATUS violations=[...]    │
└─────────────────────────────┘
                │
                ▼
┌─────────────────────────────┐
│  ~/.oss/logs/current-session│
│  ├── session.log           │  ← unified log
│  ├── build.log             │  ← command log
│  └── plan.log              │
└─────────────────────────────┘
```

## Log Format

### Pre-Check Entry (per prompt)
```
[15:30:45] [precheck] [IRON_LAW] PASSED laws=[1,2,4]
[15:30:45] [precheck] [IRON_LAW] FAILED violations=[4] laws=[1,2]
```

### Completion Checklist (per command)
```
[15:45:00] [build] [IRON_LAW] # IRON LAW COMPLIANCE:
[15:45:00] [build] [IRON_LAW] #   [✓] LAW #1: TDD - Tests written first
[15:45:00] [build] [IRON_LAW] #   [✓] LAW #2: Behavior tests
[15:45:00] [build] [IRON_LAW] #   [✓] LAW #3: No loops detected
[15:45:00] [build] [IRON_LAW] #   [✓] LAW #4: On feature branch
[15:45:00] [build] [IRON_LAW] #   [✓] LAW #5: Agent delegation used
[15:45:00] [build] [IRON_LAW] #   [✓] LAW #6: Dev docs synced
[15:45:00] [build] [IRON_LAW] #   Result: 6/6 laws observed
```

## Integration with Existing Systems

### IronLawLogParser Compatibility
The existing `IronLawLogParser` in the watcher expects:
- `❌ LAW #(\d+):` for violations
- `✅ LAW #(\d+):` for passes
- `→ (.+)` for corrections

New log entries will use:
- `[IRON_LAW] FAILED violations=[...]` for machine parsing
- Human-readable checklist for the completion format

### Supervisor Integration
The supervisor's `IronLawMonitor` can:
1. Watch session.log for `[IRON_LAW]` entries
2. Parse violation arrays
3. Track compliance over time
4. Escalate repeated violations

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLAUDE_PLUGIN_ROOT` | Plugin installation path |
| `OSS_CURRENT_COMMAND` | Currently executing command (set by wrapper) |

## Files Modified

1. `hooks/oss-log.sh` - Add `ironlaw` action
2. `hooks/oss-iron-law-check.sh` - Call oss-log.sh
3. `commands/*.md` - Add completion checklist logging

## Testing Strategy

1. **Unit tests** for `oss-log.sh ironlaw` action
2. **Integration tests** for hook logging
3. **E2E tests** for full workflow compliance tracking

---

*Created: 2025-12-09*
