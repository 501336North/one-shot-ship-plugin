# Design: Statusbar Refactor

## Vision

The statusbar is the **command board** - the real-time trust interface between the user and the OSS Dev Workflow. It must:

1. **Always be accurate** - Never show stale or incorrect data
2. **Prioritize signal over noise** - Show only what's relevant right now
3. **Be beautiful** - Aesthetically pleasing for developers
4. **Build trust** - Users should feel confident the system is working

## Display States

### 1. Idle State (Minimal)
When not in an active workflow, show only essential info:

```
✅ 🌿 feat/auth → plan
```

Components:
- Health indicator (✅ or ⛔ LAW#X)
- Current branch (🌿 or ⚠️ for main)
- Suggested next command (if known)

### 2. Active Workflow State
During command execution, show hierarchical workflow info:

```
[build] 🔴 3/8 | 🤖 react-specialist | 🌿 feat/x | ✓
```

Components:
- [command] with TDD phase emoji and progress
- Active agent (if spawned)
- Branch
- Supervisor status (✓ = watching)

### 3. Supervisor Intervening State
When issues are detected, supervisor takes priority:

```
⚡ 🚨 2 issues | [build] BLOCKED | 🌿 feat/x
```

Components:
- ⚡ intervention indicator (FIRST, unmissable)
- Queue alert with count
- Blocked workflow status
- Branch

### 4. LAW#4 Violation State
When on main/master branch:

```
⛔ LAW#4 | ⚠️ main → create feature branch
```

Components:
- Health violation (FIRST)
- Warning branch indicator
- Suggested fix

### 5. Notification State (Temporary)
When a notification is active (auto-expires):

```
📣 Context 2h ago | ✅ 🌿 feat/auth → plan
```

Components:
- Notification message (appears last, auto-expires)
- Normal state follows

## Section Priority Rules

1. **Critical alerts always first**: ⚡ and ⛔ LAW#X
2. **Queue alerts second**: 🚨 when supervisor is intervening
3. **Workflow state third**: [cmd] phase progress
4. **Context fourth**: branch and supervisor checkmark
5. **Suggestions fifth**: → next (only when idle)
6. **Notifications last**: 📣 (auto-expire)

## State Consolidation

### Before (Fragmented)
```
~/.oss/workflow-state.json    ← workflow
~/.oss/queue.json             ← queue
~/.oss/iron-law-state.json    ← health
git branch --show-current      ← branch (live)
```

### After (Consolidated)
```
~/.oss/workflow-state.json    ← ALL state except branch
git branch --show-current      ← branch (must stay live)
```

New workflow-state.json structure:
```typescript
{
  // Existing
  supervisor: 'watching' | 'intervening' | 'idle';
  currentCommand?: string;
  nextCommand?: string;
  tddPhase?: 'red' | 'green' | 'refactor';
  progress?: string;
  activeAgent?: { type: string; task: string };
  notification?: { message: string; expiresAt: string };

  // New - consolidated from queue.json
  queueSummary?: {
    critical: number;
    pending: number;
    topIssue?: string;
  };

  // New - consolidated from iron-law-state.json
  health?: {
    status: 'ok' | 'violation';
    violatedLaw?: number;
    message?: string;
  };
}
```

## Notification Message Rules

### Context Restored
- If saveDate is parseable: "Saved Xh ago"
- If saveDate is "unknown" or empty: "Context restored"
- Never show: "Saved unknown"

### Fresh Start
- Show: "Ready"
- Or show nothing (minimal)

## Performance Requirements

- Statusline must render in < 100ms
- Single JSON file read (consolidated state)
- One git command (branch check)
- No network calls

## Emoji Reference

| Symbol | Meaning |
|--------|---------|
| ✅ | Health OK |
| ⛔ | IRON LAW violation |
| ⚡ | Supervisor intervening |
| 🚨 | Critical queue issues |
| 📋 | Pending queue items |
| 🔴 | TDD RED phase |
| 🟢 | TDD GREEN phase |
| 🔄 | TDD REFACTOR phase |
| 🤖 | Active agent |
| 🌿 | Feature branch |
| ⚠️ | Warning (on main) |
| ✓ | Supervisor watching |
| → | Suggested next command |
| 📣 | Notification |

---

*Created: 2025-12-22*
