# Implementation Notes: Perfect Logging System

## Key Observations

### 1. oss-log.sh is Already Comprehensive
The existing `oss-log.sh` has most actions needed. Gaps:
- No `hook` action for hook execution logging
- No `skill` action for skill execution logging
- No `milestone` action for command progress
- No `recovery` or `timeout` actions for error handling

### 2. Hook Chain Order (hooks.json)
```
UserPromptSubmit hooks execute in order:
1. oss-context-gate.sh
2. oss-precommand.sh
3. oss-iron-law-check.sh
4. oss-context-inject.sh
```
Each needs START/COMPLETE logging.

### 3. Session Events
```
SessionStart → oss-session-start.sh
SessionEnd → oss-session-end.sh
PreCompact → oss-session-end.sh
Notification → oss-notification.sh
Stop → oss-stop.sh
```

### 4. Current Session Log Format
```
[HH:MM:SS] [cmd] [EVENT] message
```
This is good, but inconsistent. Some entries use `[TYPE]` in message.

### 5. Workflow Logger (TypeScript)
```typescript
// Writes JSON + human-readable to workflow.log
// Different from session.log
// Used by watcher for supervisor
```

## Implementation Approach

### Step 1: Add New Actions to oss-log.sh
```bash
hook)    # Log hook execution
skill)   # Log skill execution
milestone) # Log command milestones
recovery)  # Log error recovery
timeout)   # Log timeouts
```

### Step 2: Update Hooks with Logging
Each hook gets:
```bash
# At start
"$PLUGIN_ROOT/hooks/oss-log.sh" hook "$(basename $0 .sh)" START

# At end (before exit 0)
"$PLUGIN_ROOT/hooks/oss-log.sh" hook "$(basename $0 .sh)" COMPLETE
```

### Step 3: Update Command Prompts
Template for every command:
```markdown
## Step N: Initialize Logging
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init {command}

## After key milestones
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh milestone {command} {milestone_name} "{description}"

## Before agent delegation
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh agent {command} {agent_type} "starting: {task}"

## After agent complete
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh agent {command} {agent_type} "completed: {result}"
```

## Gotchas

### 1. $PLUGIN_ROOT vs $CLAUDE_PLUGIN_ROOT
- Hooks use: `PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$SCRIPT_DIR")}"`
- Prompts use: `$CLAUDE_PLUGIN_ROOT`
- Be consistent!

### 2. Session Log vs Command Log
- `session.log` - unified, has `[cmd]` prefix
- `{command}.log` - per-command, no prefix needed
- Both get written by `log_entry()` function

### 3. Background Process Logging
- Health check runs in background `&`
- Must still log to session.log
- Use append `>>` not overwrite `>`

### 4. Log Rotation
- Already implemented in oss-log.sh
- Max 10MB session, 500KB per command
- Archives auto-cleaned after 7 days

## Questions to Resolve

1. Should skills have their own log files like commands?
   - Decision: No, use session.log with `[skill]` prefix

2. Should daemon logs go to workflow.log or session.log?
   - Decision: Both - workflow.log (structured) + session.log (human)

3. How to handle concurrent agent execution?
   - Decision: Include agent ID in log entries

---

*Last Updated: 2025-12-25*
