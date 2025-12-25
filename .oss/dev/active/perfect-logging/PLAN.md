# TDD Implementation Plan: Perfect Logging System

## Overview

Create an absolutely perfect logging system that provides the supervisor with complete visibility into the state of the OSS Dev Workflow system. Every command, agent, hook, skill, and daemon action must be logged as the single source of truth.

## Current State Analysis

### What Currently Logs (Good)
1. **oss-log.sh** - Comprehensive shell script with:
   - `init`, `write`, `phase`, `tool`, `test`, `error`, `file`, `agent`, `progress`
   - `ironlaw`, `checklist`, `health`, `workflow` actions
   - Unified session log at `~/.oss/logs/current-session/session.log`
   - Command-specific logs at `~/.oss/logs/current-session/{command}.log`

2. **oss-notify.sh** - Updates workflow state + writes to logs
3. **workflow-logger.ts** - TypeScript logger with structured JSON + human-readable output
4. **Command prompts** - Plan, Build have logging instructions

### What's Missing (Gaps)

#### 1. Hook Execution Logging
- SessionStart hook doesn't log to session.log
- SessionEnd hook doesn't log
- PreCompact hook doesn't log
- Notification hook doesn't log
- Stop hook doesn't log
- Iron law check hook partial logging
- Precommand hook no logging

#### 2. Skill Execution Logging
- Skills don't have standardized logging instructions
- No entry/exit logging for skills
- No result logging from skills

#### 3. Agent Delegation Logging
- Missing standardized agent spawn/complete logging across ALL commands
- Agent results not captured

#### 4. Daemon Process Logging
- Watcher process has limited logging
- Health check scheduler not logging
- TDD monitor not logging
- Git monitor not logging

#### 5. Error/Exception Logging
- Uncaught exceptions not consistently logged
- Error recovery paths not logged

## Architecture Decision

### Log Format (Standardized)
```
[HH:MM:SS] [COMPONENT] [EVENT] message key=value key=value
```

Components:
- `session` - Session lifecycle
- `hook` - Hook execution
- `command` - Command execution (ideate, plan, build, ship, etc.)
- `skill` - Skill execution
- `agent` - Agent delegation
- `daemon` - Background processes
- `health` - Health checks
- `error` - Errors and exceptions

Events:
- `START` - Component begins execution
- `COMPLETE` - Component finishes successfully
- `FAILED` - Component fails
- `PROGRESS` - Progress update
- `PHASE` - TDD phase transition (RED, GREEN, REFACTOR)
- `TEST` - Test execution result
- `SPAWN` - Agent spawned
- `DELEGATE` - Work delegated

---

## Phase 1: Hook Logging Infrastructure

### Task 1.1: Add hook logging helper to oss-log.sh
**Test**: Hook logging action with proper format
```bash
# Test: oss-log.sh hook <hook_name> <event> [details]
$PLUGIN_ROOT/hooks/oss-log.sh hook SessionStart START
# Expected: [HH:MM:SS] [hook] [START] SessionStart
```

### Task 1.2: Add session logging to oss-session-start.sh
**Test**: Session start appears in session.log with all metadata
```bash
# After session start, log should contain:
grep "session.*START" ~/.oss/logs/current-session/session.log
# Expected: [HH:MM:SS] [session] [START] project=foo branch=feat/bar
```

### Task 1.3: Add session logging to oss-session-end.sh
**Test**: Session end appears in session.log
```bash
# After session end, log should contain:
grep "session.*END" ~/.oss/logs/current-session/session.log
# Expected: [HH:MM:SS] [session] [END] duration=1h23m commands=3
```

### Task 1.4: Add hook logging to all UserPromptSubmit hooks
**Test**: Each hook logs entry/exit to session.log
```bash
# Hooks: oss-context-gate.sh, oss-precommand.sh, oss-iron-law-check.sh, oss-context-inject.sh
grep "hook.*oss-precommand.*START" ~/.oss/logs/current-session/session.log
grep "hook.*oss-precommand.*COMPLETE" ~/.oss/logs/current-session/session.log
```

---

## Phase 2: Command Logging Standardization

### Task 2.1: Create logging template for all commands
**Test**: Template includes all required logging calls
```markdown
# Every command MUST have:
# 1. init logging
# 2. start notification
# 3. milestone logging
# 4. agent delegation logging
# 5. progress logging
# 6. complete/failed notification
```

### Task 2.2: Add milestone logging action to oss-log.sh
**Test**: Milestones logged with description
```bash
$PLUGIN_ROOT/hooks/oss-log.sh milestone plan archive_check "Checked for features to archive"
# Expected: [HH:MM:SS] [plan] [MILESTONE] archive_check: Checked for features to archive
```

### Task 2.3: Update all commands to use consistent logging
**Test**: Audit each command for logging compliance
- ideate.md
- plan.md
- build.md
- ship.md
- red.md
- green.md
- refactor.md
- acceptance.md
- integration.md
- review.md

### Task 2.4: Add tool logging to oss-log.sh for all tool calls
**Test**: Tool usage is tracked
```bash
$PLUGIN_ROOT/hooks/oss-log.sh tool build Read "/src/foo.ts"
# Expected: [HH:MM:SS] [build] [TOOL] Read: /src/foo.ts
```

---

## Phase 3: Agent Delegation Logging

### Task 3.1: Standardize agent logging in all commands
**Test**: Every Task tool call is logged
```bash
# Before agent spawn:
$PLUGIN_ROOT/hooks/oss-log.sh agent build typescript-pro "starting: Fix type errors in auth module"
# After agent complete:
$PLUGIN_ROOT/hooks/oss-log.sh agent build typescript-pro "completed: Fixed 5 type errors"
```

### Task 3.2: Add agent ID tracking
**Test**: Agent IDs captured for resume capability
```bash
$PLUGIN_ROOT/hooks/oss-log.sh agent build typescript-pro "spawned id=abc123"
$PLUGIN_ROOT/hooks/oss-log.sh agent build typescript-pro "complete id=abc123 duration=45s"
```

### Task 3.3: Add agent result capture
**Test**: Agent results logged for supervisor analysis
```bash
$PLUGIN_ROOT/hooks/oss-log.sh agent build typescript-pro "result: 5 files modified, 0 errors"
```

---

## Phase 4: Skill Execution Logging

### Task 4.1: Create skill logging template
**Test**: Skills log start/complete/failed
```bash
# Every skill MUST log:
$PLUGIN_ROOT/hooks/oss-log.sh skill {skill_name} START "{args}"
# ... skill execution ...
$PLUGIN_ROOT/hooks/oss-log.sh skill {skill_name} COMPLETE "{result}"
```

### Task 4.2: Add skill action to oss-log.sh
**Test**: Skill logging works correctly
```bash
$PLUGIN_ROOT/hooks/oss-log.sh skill create-dev-docs START "feature=auth-module"
# Expected: [HH:MM:SS] [skill] [START] create-dev-docs feature=auth-module
```

### Task 4.3: Update all skills with logging
**Test**: Each skill has proper logging
- create-dev-docs.md
- build.md (skill version)
- plan.md (skill version)
- etc.

---

## Phase 5: Daemon/Watcher Logging

### Task 5.1: Add daemon logging to workflow-logger.ts
**Test**: Daemon events logged to workflow.log
```typescript
logger.log({
  cmd: 'daemon',
  event: 'START',
  data: { component: 'health-check-scheduler', interval: '5m' }
});
```

### Task 5.2: Add health check logging
**Test**: Health checks logged with results
```bash
grep "daemon.*health-check.*COMPLETE" ~/.oss/workflow.log
# Expected: {"ts":"...","cmd":"daemon","event":"COMPLETE","data":{"component":"health-check","result":"all_pass"}}
```

### Task 5.3: Add watcher event logging
**Test**: Watcher detects and logs anomalies
```bash
grep "daemon.*watcher.*ANOMALY" ~/.oss/workflow.log
# Expected: {"ts":"...","cmd":"daemon","event":"ANOMALY","data":{"type":"loop_detected","details":"..."}}
```

### Task 5.4: Add TDD monitor logging
**Test**: TDD phase transitions logged
```bash
grep "daemon.*tdd-monitor" ~/.oss/workflow.log
# Expected: TDD phase violations detected and logged
```

---

## Phase 6: Error Handling Logging

### Task 6.1: Add uncaught exception logging
**Test**: Exceptions logged with stack traces
```bash
$PLUGIN_ROOT/hooks/oss-log.sh error build "TypeError: Cannot read property 'x' of undefined\n  at foo.ts:42"
# Expected: [HH:MM:SS] [build] [ERROR] TypeError: Cannot read property 'x' of undefined
```

### Task 6.2: Add recovery action logging
**Test**: Recovery attempts logged
```bash
$PLUGIN_ROOT/hooks/oss-log.sh recovery build "Retrying after error" "attempt=2"
```

### Task 6.3: Add timeout detection logging
**Test**: Hung processes logged
```bash
$PLUGIN_ROOT/hooks/oss-log.sh timeout build "Process hung after 60s" "pid=12345"
```

---

## Verification Checklist

After implementation, the supervisor should be able to answer:

1. **What commands ran in this session?**
   ```bash
   grep "\[.*\] \[INIT\]" ~/.oss/logs/current-session/session.log
   ```

2. **What agents were spawned?**
   ```bash
   grep "\[AGENT\]" ~/.oss/logs/current-session/session.log
   ```

3. **What TDD phases occurred?**
   ```bash
   grep "\[PHASE\]" ~/.oss/logs/current-session/session.log
   ```

4. **What tests passed/failed?**
   ```bash
   grep "\[TEST\]" ~/.oss/logs/current-session/session.log
   ```

5. **What errors occurred?**
   ```bash
   grep "\[ERROR\]" ~/.oss/logs/current-session/session.log
   ```

6. **What hooks executed?**
   ```bash
   grep "\[hook\]" ~/.oss/logs/current-session/session.log
   ```

7. **What is the current workflow state?**
   ```bash
   tail -20 ~/.oss/logs/current-session/session.log
   ```

---

## Success Criteria

- [ ] Every hook logs START/COMPLETE/FAILED
- [ ] Every command logs init + milestones + complete/failed
- [ ] Every agent delegation logs spawn + complete + result
- [ ] Every skill logs start + complete/failed
- [ ] Every daemon component logs state changes
- [ ] All errors logged with context
- [ ] Supervisor can reconstruct full session from logs
- [ ] Log format is consistent across all components

---

## Files to Modify

### Hooks (~/dev/one-shot-ship-plugin/hooks/)
- oss-log.sh - Add new actions: `hook`, `skill`, `milestone`, `recovery`, `timeout`
- oss-session-start.sh - Add session logging
- oss-session-end.sh - Add session logging
- oss-precommand.sh - Add hook logging
- oss-iron-law-check.sh - Add hook logging
- oss-context-gate.sh - Add hook logging
- oss-context-inject.sh - Add hook logging
- oss-notification.sh - Add hook logging
- oss-stop.sh - Add hook logging

### Commands (~/dev/one-shot-ship-plugin/commands/)
- All 40+ command files - Add standardized logging

### Skills (~/dev/one-shot-ship-plugin/skills/)
- All skill files - Add standardized logging

### Watcher (~/dev/one-shot-ship-plugin/watcher/src/)
- logger/workflow-logger.ts - Add daemon events
- healthchecks/*.ts - Add health check logging
- monitors/*.ts - Add monitor logging
- daemon/src/*.ts - Add daemon logging

---

*Plan created: 2025-12-25*
*Phases: 6*
*Tasks: 23*
