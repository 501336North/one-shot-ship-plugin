# Design: Status Line Auto-Workflow Hooks

## Problem Statement

1. **Status line doesn't auto-update** - Agent must manually call notification hooks
2. **No "next command" guidance** - User doesn't know what to run after a step completes
3. **Git branch bug** - Status line reads branch from script CWD, not project directory
4. **terminal-notifier dependency** - Visual notifications still use external tool

## Solution Architecture

### Automatic Workflow State Updates

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code Session                       │
│                                                               │
│  User runs: /oss:plan                                        │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ PreToolCall Hook (automatic)                            ││
│  │  └─ oss-workflow-auto.sh pre plan                       ││
│  │      └─ Sets currentCommand="plan"                      ││
│  │      └─ Sets supervisor="watching"                      ││
│  └─────────────────────────────────────────────────────────┘│
│                           ↓                                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Command Execution                                        ││
│  │  └─ plan.md prompt runs                                 ││
│  │  └─ Status line shows: "plan → build"                   ││
│  └─────────────────────────────────────────────────────────┘│
│                           ↓                                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ PostToolCall Hook (automatic)                           ││
│  │  └─ oss-workflow-auto.sh post plan                      ││
│  │      └─ Sets nextCommand="build"                        ││
│  │      └─ Clears currentCommand                           ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
│  Status line now shows: "→ build"                            │
└─────────────────────────────────────────────────────────────┘
```

### Workflow Command Chain

```
ideate → plan → build → ship → (done)
   │       │       │       │
   └─────→ └─────→ └─────→ └─────→ nextCommand derived automatically
```

### Status Line Format

**Before:**
```
✅ [Opus] my-project | ⚠️ main | 🟢 GREEN 3/10 ✓ | 📋2: Task | 📣 Building
```

**After:**
```
✅ [Opus] my-project | 🌿 feat/auth | plan → build | 🟢 3/10 ✓
```

Key changes:
- Workflow step and next command shown prominently
- TDD phase is emoji-only (cleaner)
- Message section removed (redundant with workflow display)
- Queue only shown if non-empty

## Data Model Changes

### WorkflowState Interface

```typescript
interface WorkflowState {
  // Existing fields
  supervisor: SupervisorStatus;
  activeStep: ChainStep | null;
  chainState: Record<ChainStep, StepStatus>;
  activeAgent?: ActiveAgent;
  tddPhase?: string;
  message?: string;
  currentTask?: string;
  progress?: string;
  testsPass?: number;
  tddCycle?: number;
  lastUpdate: string;

  // New fields
  currentCommand?: string;  // Currently executing /oss:* command
  nextCommand?: string | null;  // Recommended next command
}
```

### Next Command Derivation

```typescript
const NEXT_COMMAND_MAP: Record<string, string | null> = {
  ideate: 'plan',
  plan: 'build',
  build: 'ship',
  ship: null,  // Workflow complete

  // TDD sub-commands stay in build
  red: null,
  green: null,
  refactor: null,
  acceptance: null,
};
```

## Hook Configuration

### hooks.json

```json
{
  "hooks": [
    {
      "event": "PreToolCall",
      "command": "$CLAUDE_PLUGIN_ROOT/hooks/oss-workflow-auto.sh pre $SKILL_NAME",
      "matcher": {
        "tool": "Skill",
        "skillPrefix": "oss:"
      }
    },
    {
      "event": "PostToolCall",
      "command": "$CLAUDE_PLUGIN_ROOT/hooks/oss-workflow-auto.sh post $SKILL_NAME",
      "matcher": {
        "tool": "Skill",
        "skillPrefix": "oss:"
      }
    }
  ]
}
```

### oss-workflow-auto.sh

```bash
#!/bin/bash
EVENT="$1"    # "pre" or "post"
COMMAND="$2"  # "plan", "build", etc.

CLI="${CLAUDE_PLUGIN_ROOT}/watcher/dist/cli/update-workflow-state.js"

case "$EVENT" in
  pre)
    node "$CLI" setCurrentCommand "$COMMAND"
    node "$CLI" setSupervisor watching
    ;;
  post)
    case "$COMMAND" in
      ideate) node "$CLI" setNextCommand plan ;;
      plan)   node "$CLI" setNextCommand build ;;
      build)  node "$CLI" setNextCommand ship ;;
      ship)   node "$CLI" clearNextCommand ;;
    esac
    node "$CLI" clearCurrentCommand
    ;;
esac
```

## Git Branch Fix

### Current (buggy)
```bash
BRANCH=$(git branch --show-current 2>/dev/null)
```

### Fixed
```bash
if [[ -n "$CURRENT_PROJECT" ]]; then
  BRANCH=$(git -C "$CURRENT_PROJECT" branch --show-current 2>/dev/null)
else
  BRANCH=$(git branch --show-current 2>/dev/null)
fi
```

## terminal-notifier Migration

### Current
```typescript
case 'visual':
  return `terminal-notifier -title "${title}" -message "${message}"`;
```

### New
```typescript
case 'visual':
  return `node "${cli}" setMessage "${message}"`;
```

The status line already refreshes automatically, so setting the message field makes it visible immediately.

## Success Metrics

1. **Zero manual state updates** - Agent never needs to call oss-notify.sh
2. **Always shows next step** - User always knows what command to run
3. **Branch always correct** - Uses project directory, not script CWD
4. **No terminal-notifier** - Status line is the visual notification

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Hook not firing | Add logging to hook script, fallback to manual |
| State file corruption | Graceful defaults, auto-recovery |
| Permission issues | Ensure scripts are +x on install |

---

*Design approved: 2024-12-21*
