# Design: Subcommand/Subagent Status Updates

## Problem Statement

Currently, the Claude Code status line updates when `/oss:build`, `/oss:plan`, etc. run via `oss-notify.sh --workflow`. However, when these commands run subcommands (`/oss:red`, `/oss:green`, `/oss:refactor`) or spawn subagents via the Task tool, the status line doesn't reflect these TDD phase transitions or agent activity.

Users expect to see:
- Which TDD phase they're in (RED/GREEN/REFACTOR) during `/oss:build`
- Which agent is currently working on their behalf

## Current Flow

```
/oss:build
  └─> oss-notify.sh --workflow build start
        └─> update-workflow-state.js setActiveStep build
  └─> oss-log.sh phase build RED start
        └─> Writes to log file only (NO state update)
  └─> Task tool spawns react-specialist agent
        └─> No status update
  └─> oss-log.sh phase build GREEN start
        └─> Writes to log file only (NO state update)
```

## Proposed Flow

```
/oss:build
  └─> oss-notify.sh --workflow build start
        └─> update-workflow-state.js setActiveStep build
  └─> oss-log.sh phase build RED start
        └─> Writes to log file
        └─> update-workflow-state.js setTddPhase red    <-- NEW
  └─> Task tool spawns react-specialist agent
        └─> oss-log.sh agent build react-specialist "starting: UserProfile"
              └─> update-workflow-state.js setActiveAgent  <-- NEW
  └─> oss-log.sh phase build GREEN start
        └─> Writes to log file
        └─> update-workflow-state.js setTddPhase green  <-- NEW
```

## Workflow State Schema Changes

### Before
```json
{
  "supervisor": "watching",
  "activeStep": "build",
  "tddPhase": null,
  "chainState": { ... },
  "progress": "3/8",
  "currentTask": "UserProfile component",
  "lastUpdate": "2025-12-21T14:30:00Z"
}
```

### After
```json
{
  "supervisor": "watching",
  "activeStep": "build",
  "tddPhase": "red",
  "activeAgent": {
    "type": "react-specialist",
    "task": "UserProfile component",
    "startedAt": "2025-12-21T14:30:00Z"
  },
  "chainState": { ... },
  "progress": "3/8",
  "currentTask": "UserProfile component",
  "lastUpdate": "2025-12-21T14:30:00Z"
}
```

## Status Line Display

### Current
```
[Claude] project | 🌿 feat/auth | ✅ | 🤖 build ✓
```

### Proposed
```
[Claude] project | 🌿 feat/auth | ✅ | 🔴 RED 3/8 | 🤖 react-specialist ✓
```

Format:
- `🔴 RED` / `🟢 GREEN` / `🔵 REFACTOR` - Current TDD phase
- `3/8` - Progress (optional, from existing progress field)
- `🤖 react-specialist` - Active agent (when present)
- `✓` / `⚡` - Supervisor watching/intervening

## oss-log.sh Changes

### Phase Command Handler
```bash
# When: oss-log.sh phase <command> <phase> start
phase_handler() {
    local command="$1"
    local phase="$2"
    local action="$3"

    # Existing: Write to log
    log_write "[$phase] $action"

    # NEW: Update workflow state for TDD phases
    if [[ "$action" == "start" ]]; then
        local phase_lower=$(echo "$phase" | tr '[:upper:]' '[:lower:]')
        if [[ "$phase_lower" == "red" || "$phase_lower" == "green" || "$phase_lower" == "refactor" ]]; then
            node "$WORKFLOW_STATE_CLI" setTddPhase "$phase_lower" 2>/dev/null || true
        fi
    fi
}
```

### Agent Command Handler
```bash
# When: oss-log.sh agent <command> <agent_type> "<message>"
agent_handler() {
    local command="$1"
    local agent_type="$2"
    local message="$3"

    # Existing: Write to log
    log_write "[AGENT] $agent_type: $message"

    # NEW: Update workflow state based on message
    if [[ "$message" == starting:* ]]; then
        local task="${message#starting: }"
        node "$WORKFLOW_STATE_CLI" setActiveAgent "{\"type\":\"$agent_type\",\"task\":\"$task\"}" 2>/dev/null || true
        node "$WORKFLOW_STATE_CLI" setSupervisor intervening 2>/dev/null || true
    elif [[ "$message" == completed:* ]]; then
        node "$WORKFLOW_STATE_CLI" clearActiveAgent 2>/dev/null || true
        node "$WORKFLOW_STATE_CLI" setSupervisor watching 2>/dev/null || true
    fi
}
```

## oss-statusline.sh Changes

```bash
# Read activeAgent
ACTIVE_AGENT_TYPE=$(jq -r '.activeAgent.type // ""' "$WORKFLOW_FILE" 2>/dev/null)
ACTIVE_AGENT_TASK=$(jq -r '.activeAgent.task // ""' "$WORKFLOW_FILE" 2>/dev/null)

# Display agent if present
if [[ -n "$ACTIVE_AGENT_TYPE" && "$ACTIVE_AGENT_TYPE" != "null" ]]; then
    # Truncate task to 20 chars
    if [[ ${#ACTIVE_AGENT_TASK} -gt 20 ]]; then
        ACTIVE_AGENT_TASK="${ACTIVE_AGENT_TASK:0:17}..."
    fi
    AGENT_DISPLAY=" | 🤖 $ACTIVE_AGENT_TYPE: $ACTIVE_AGENT_TASK"
fi
```

## Edge Cases

1. **Agent spawns during non-build command**: Agent status should still show
2. **Multiple agents spawned in parallel**: Show first, queue others (future enhancement)
3. **Agent crashes without completing**: Cleared on next phase start
4. **tddPhase set during non-TDD workflow**: Ignored, only set during build phases

## Security Considerations

- Agent type is validated against known list (prevent injection via log message)
- Task description is sanitized before display (truncate, no special chars)
- State file permissions remain restrictive (600)

## Performance Considerations

- State updates run in background with `|| true` to not block logging
- jq parsing in statusline is cached (file mtime check)
- No network calls in status line script

---

**Last Updated**: 2025-12-21
