# TDD Implementation Plan: Status Line Auto-Workflow Hooks

## Feature Overview

Optimize the Claude Code status line to automatically track workflow state, show next commands, and fix the git branch display bug. Remove reliance on terminal-notifier for visual notifications.

## Goals

1. **Automatic workflow state updates** - Hooks fire on every `/oss:*` command
2. **Show next command** - User always knows what to run next
3. **Fix git branch bug** - Use project directory for git commands
4. **Simplify display** - Emoji-only TDD phases, cleaner layout
5. **Migrate from terminal-notifier** - Status line is the visual notification system

## Proposed Status Line Format

```
HEALTH [Model] Dir | BRANCH | WORKFLOW → NEXT | TDD PROGRESS | AGENT/ISSUE
```

### Examples

```
✅ [Opus] my-project | 🌿 feat/auth | plan → build | 🟢 3/10
⛔ #4 [Opus] my-project | ⚠️ main | → checkout feat/
✅ [Opus] my-project | 🌿 feat/auth | build → ship | ✓ 10/10
```

---

## Phase 1: Fix Git Branch Bug (RED → GREEN → REFACTOR)

### Task 1.1: Test git branch reads from project directory

**Test file:** `watcher/test/hooks/oss-statusline-git.test.ts`

```typescript
/**
 * @behavior Status line reads git branch from workspace.current_dir, not script CWD
 * @acceptance-criteria Branch display reflects project directory, not invocation directory
 */
it('should read git branch from workspace.current_dir, not script CWD', () => {
  // GIVEN: Project A is on feat/a, Project B is on feat/b
  // AND: Script is invoked from Project B
  // AND: stdin says workspace.current_dir is Project A
  // WHEN: Running statusline script
  // THEN: Output shows feat/a (from stdin), not feat/b (from CWD)
});
```

### Task 1.2: Implement git -C fix in oss-statusline.sh

**File:** `hooks/oss-statusline.sh`

Change:
```bash
# Old
if git rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git branch --show-current 2>/dev/null)

# New
if [[ -n "$CURRENT_PROJECT" ]] && git -C "$CURRENT_PROJECT" rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git -C "$CURRENT_PROJECT" branch --show-current 2>/dev/null)
```

---

## Phase 2: Add nextCommand to WorkflowState (RED → GREEN → REFACTOR)

### Task 2.1: Test nextCommand field exists in WorkflowState

**Test file:** `watcher/test/services/workflow-state-next-command.test.ts`

```typescript
/**
 * @behavior WorkflowState tracks the next recommended command
 * @acceptance-criteria nextCommand field is set after workflow step completion
 */
describe('nextCommand tracking', () => {
  it('should have nextCommand field in state', async () => {
    const state = await service.getState();
    expect(state).toHaveProperty('nextCommand');
  });

  it('should set nextCommand to "plan" after ideate completes', async () => {
    await service.completeStep('ideate');
    const state = await service.getState();
    expect(state.nextCommand).toBe('plan');
  });

  it('should set nextCommand to "build" after plan completes', async () => {
    await service.completeStep('plan');
    const state = await service.getState();
    expect(state.nextCommand).toBe('build');
  });

  it('should set nextCommand to "ship" after build completes', async () => {
    await service.completeStep('build');
    const state = await service.getState();
    expect(state.nextCommand).toBe('ship');
  });

  it('should clear nextCommand after ship completes', async () => {
    await service.completeStep('ship');
    const state = await service.getState();
    expect(state.nextCommand).toBeNull();
  });
});
```

### Task 2.2: Implement nextCommand in WorkflowStateService

**File:** `watcher/src/services/workflow-state.ts`

Add to interface:
```typescript
interface WorkflowState {
  // ... existing
  nextCommand?: string | null;  // 'ideate' | 'plan' | 'build' | 'ship' | null
}
```

Add logic to `completeStep()`:
```typescript
const NEXT_COMMAND_MAP: Record<string, string | null> = {
  ideate: 'plan',
  plan: 'build',
  build: 'ship',
  ship: null,
};

async completeStep(step: ChainStep): Promise<void> {
  const state = await this.getState();
  state.chainState[step] = 'done';
  state.activeStep = null;
  state.currentCommand = undefined;
  state.nextCommand = NEXT_COMMAND_MAP[step] ?? null;
  await this.writeState(state);
}
```

### Task 2.3: Test CLI command for setNextCommand

**Test file:** `watcher/test/cli/update-workflow-state-next-command.test.ts`

```typescript
it('should support setNextCommand CLI command', () => {
  execSync(`node ${cli} setNextCommand build`);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  expect(state.nextCommand).toBe('build');
});
```

---

## Phase 3: Status Line Display Updates (RED → GREEN → REFACTOR)

### Task 3.1: Test status line shows nextCommand with arrow

**Test file:** `watcher/test/hooks/oss-statusline-next-command.test.ts`

```typescript
/**
 * @behavior Status line shows next command with arrow when set
 * @acceptance-criteria Format: "plan → build" when currentCommand=plan, nextCommand=build
 */
it('should display nextCommand with arrow', () => {
  // GIVEN: workflow state has currentCommand=plan, nextCommand=build
  const state = { currentCommand: 'plan', nextCommand: 'build' };
  fs.writeFileSync(workflowFile, JSON.stringify(state));

  // WHEN: Running statusline
  const output = execSync(`echo '${input}' | bash "${script}"`);

  // THEN: Output contains "plan → build"
  expect(output.toString()).toContain('plan → build');
});

it('should show only nextCommand when no currentCommand', () => {
  // GIVEN: workflow state has only nextCommand=ideate (fresh start)
  const state = { nextCommand: 'ideate' };

  // THEN: Output contains "→ ideate"
  expect(output.toString()).toContain('→ ideate');
});
```

### Task 3.2: Implement nextCommand display in oss-statusline.sh

**File:** `hooks/oss-statusline.sh`

Add after reading workflow state:
```bash
NEXT_CMD=$(jq -r '.nextCommand // ""' "$WORKFLOW_FILE" 2>/dev/null)
CURRENT_CMD=$(jq -r '.currentCommand // ""' "$WORKFLOW_FILE" 2>/dev/null)

WORKFLOW_DISPLAY=""
if [[ -n "$CURRENT_CMD" && "$CURRENT_CMD" != "null" ]]; then
    if [[ -n "$NEXT_CMD" && "$NEXT_CMD" != "null" ]]; then
        WORKFLOW_DISPLAY=" | $CURRENT_CMD → $NEXT_CMD"
    else
        WORKFLOW_DISPLAY=" | $CURRENT_CMD"
    fi
elif [[ -n "$NEXT_CMD" && "$NEXT_CMD" != "null" ]]; then
    WORKFLOW_DISPLAY=" | → $NEXT_CMD"
fi
```

### Task 3.3: Simplify TDD phase to emoji-only

**Test file:** `watcher/test/hooks/oss-statusline-tdd-emoji.test.ts`

```typescript
/**
 * @behavior TDD phase displays as emoji only, not "🔴 RED"
 * @acceptance-criteria Output contains "🔴" not "🔴 RED"
 */
it('should display TDD phase as emoji only', () => {
  const state = { tddPhase: 'red' };
  fs.writeFileSync(workflowFile, JSON.stringify(state));

  const output = execSync(`echo '${input}' | bash "${script}"`);

  expect(output.toString()).toContain('🔴');
  expect(output.toString()).not.toContain('RED');
});
```

---

## Phase 4: Automatic Workflow Hooks (RED → GREEN → REFACTOR)

### Task 4.1: Test PreToolCall hook updates currentCommand

**Test file:** `watcher/test/hooks/oss-workflow-auto-hook.test.ts`

```typescript
/**
 * @behavior Pre-command hook automatically sets currentCommand
 * @acceptance-criteria When /oss:plan starts, currentCommand="plan" is set
 */
describe('oss-workflow-auto.sh', () => {
  it('should set currentCommand on pre event', () => {
    // GIVEN: Hook is called with pre and command name
    execSync(`bash ${hookScript} pre plan`);

    // THEN: workflow state has currentCommand=plan
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(state.currentCommand).toBe('plan');
  });

  it('should set nextCommand on post event', () => {
    // GIVEN: Hook is called with post and command name
    execSync(`bash ${hookScript} post plan`);

    // THEN: workflow state has nextCommand=build
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(state.nextCommand).toBe('build');
  });
});
```

### Task 4.2: Create oss-workflow-auto.sh hook script

**File:** `hooks/oss-workflow-auto.sh`

```bash
#!/bin/bash
# Automatic workflow state updates for /oss:* commands
# Called by Claude Code hooks on PreToolCall and PostToolCall

EVENT="$1"    # "pre" or "post"
COMMAND="$2"  # "ideate", "plan", "build", "ship", etc.

CLI="${CLAUDE_PLUGIN_ROOT}/watcher/dist/cli/update-workflow-state.js"

case "$EVENT" in
  pre)
    node "$CLI" setCurrentCommand "$COMMAND"
    node "$CLI" setSupervisor watching
    ;;
  post)
    # Derive next command from current
    case "$COMMAND" in
      ideate) NEXT="plan" ;;
      plan) NEXT="build" ;;
      build) NEXT="ship" ;;
      ship) NEXT="" ;;
      *) NEXT="" ;;
    esac

    if [[ -n "$NEXT" ]]; then
      node "$CLI" setNextCommand "$NEXT"
    else
      node "$CLI" clearNextCommand
    fi
    node "$CLI" clearCurrentCommand
    ;;
esac
```

### Task 4.3: Register hooks in hooks.json

**File:** `.claude-plugin/hooks.json`

```json
{
  "hooks": [
    {
      "event": "PreToolCall",
      "command": "$CLAUDE_PLUGIN_ROOT/hooks/oss-workflow-auto.sh pre $OSS_COMMAND",
      "matcher": { "tool": "Skill", "args": "oss:*" }
    },
    {
      "event": "PostToolCall",
      "command": "$CLAUDE_PLUGIN_ROOT/hooks/oss-workflow-auto.sh post $OSS_COMMAND",
      "matcher": { "tool": "Skill", "args": "oss:*" }
    }
  ]
}
```

---

## Phase 5: Migrate NotificationService from terminal-notifier (RED → GREEN → REFACTOR)

### Task 5.1: Test visual style uses setMessage instead of terminal-notifier

**Test file:** `watcher/test/services/notification-statusline.test.ts`

```typescript
/**
 * @behavior Visual notifications update status line message, not terminal-notifier
 * @acceptance-criteria getNotifyCommand returns setMessage command, not terminal-notifier
 */
it('should use setMessage for visual notifications', () => {
  fs.writeFileSync(settingsPath, JSON.stringify({
    notifications: { style: 'visual', verbosity: 'all' }
  }));
  service = new NotificationService(testDir);

  const event = { type: 'COMMAND_COMPLETE', title: 'Done', message: 'Build passed', priority: 'high' };
  const command = service.getNotifyCommand(event);

  expect(command).toContain('setMessage');
  expect(command).not.toContain('terminal-notifier');
});
```

### Task 5.2: Update NotificationService.getNotifyCommand()

**File:** `watcher/src/services/notification.ts`

```typescript
case 'visual':
  // Use status line message instead of terminal-notifier
  const cli = path.join(process.env.CLAUDE_PLUGIN_ROOT || '', 'watcher/dist/cli/update-workflow-state.js');
  return `node "${cli}" setMessage "${this.escapeShell(event.message)}"`;
```

### Task 5.3: Update tests that expect terminal-notifier output

**File:** `watcher/test/services/notification.test.ts`

Update test at line 178-181:
```typescript
it('should generate visual notification command', () => {
  // ... setup ...
  const command = service.getNotifyCommand(event);
  expect(command).toContain('setMessage');  // Changed from terminal-notifier
  expect(command).toContain('24 tests passing');
});
```

---

## Phase 6: Add currentCommand to CLI and Hooks (RED → GREEN → REFACTOR)

### Task 6.1: Test setCurrentCommand CLI command

**Test file:** `watcher/test/cli/update-workflow-state-current-command.test.ts`

```typescript
it('should support setCurrentCommand CLI command', () => {
  execSync(`node ${cli} setCurrentCommand plan`);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  expect(state.currentCommand).toBe('plan');
});

it('should support clearCurrentCommand CLI command', () => {
  // First set it
  execSync(`node ${cli} setCurrentCommand plan`);
  // Then clear it
  execSync(`node ${cli} clearCurrentCommand`);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  expect(state.currentCommand).toBeUndefined();
});
```

### Task 6.2: Implement setCurrentCommand in CLI

**File:** `watcher/src/cli/update-workflow-state.ts`

Add cases:
```typescript
case 'setCurrentCommand':
  await service.setCurrentCommand(args[1]);
  break;
case 'clearCurrentCommand':
  await service.clearCurrentCommand();
  break;
case 'setNextCommand':
  await service.setNextCommand(args[1]);
  break;
case 'clearNextCommand':
  await service.clearNextCommand();
  break;
```

### Task 6.3: Implement methods in WorkflowStateService

**File:** `watcher/src/services/workflow-state.ts`

```typescript
async setCurrentCommand(command: string): Promise<void> {
  const state = await this.getState();
  state.currentCommand = command;
  await this.writeState(state);
}

async clearCurrentCommand(): Promise<void> {
  const state = await this.getState();
  delete state.currentCommand;
  await this.writeState(state);
}

async setNextCommand(command: string): Promise<void> {
  const state = await this.getState();
  state.nextCommand = command;
  await this.writeState(state);
}

async clearNextCommand(): Promise<void> {
  const state = await this.getState();
  state.nextCommand = null;
  await this.writeState(state);
}
```

---

## Task Summary

| Phase | Task | Description | Test File |
|-------|------|-------------|-----------|
| 1 | 1.1 | Test git branch from project dir | oss-statusline-git.test.ts |
| 1 | 1.2 | Fix git -C in statusline.sh | (implementation) |
| 2 | 2.1 | Test nextCommand in WorkflowState | workflow-state-next-command.test.ts |
| 2 | 2.2 | Implement nextCommand logic | workflow-state.ts |
| 2 | 2.3 | Test CLI setNextCommand | update-workflow-state-next-command.test.ts |
| 3 | 3.1 | Test nextCommand display | oss-statusline-next-command.test.ts |
| 3 | 3.2 | Implement nextCommand in statusline | oss-statusline.sh |
| 3 | 3.3 | Test emoji-only TDD display | oss-statusline-tdd-emoji.test.ts |
| 4 | 4.1 | Test auto hook updates | oss-workflow-auto-hook.test.ts |
| 4 | 4.2 | Create oss-workflow-auto.sh | (implementation) |
| 4 | 4.3 | Register in hooks.json | (implementation) |
| 5 | 5.1 | Test visual uses setMessage | notification-statusline.test.ts |
| 5 | 5.2 | Update NotificationService | notification.ts |
| 5 | 5.3 | Update existing tests | notification.test.ts |
| 6 | 6.1 | Test setCurrentCommand CLI | update-workflow-state-current-command.test.ts |
| 6 | 6.2 | Implement CLI commands | update-workflow-state.ts |
| 6 | 6.3 | Implement service methods | workflow-state.ts |

---

## Dependencies

- Phase 2 depends on Phase 6 (need CLI commands for nextCommand)
- Phase 3 depends on Phase 2 (need nextCommand in state)
- Phase 4 depends on Phase 6 (hooks call CLI commands)
- Phase 5 is independent

## Recommended Order

1. Phase 6 (CLI commands - foundation)
2. Phase 2 (WorkflowState nextCommand)
3. Phase 1 (Git branch fix)
4. Phase 3 (Status line display)
5. Phase 4 (Auto hooks)
6. Phase 5 (Migrate terminal-notifier)

---

## Success Criteria

1. `git branch --show-current` uses project directory from stdin
2. Status line shows `currentCommand → nextCommand` format
3. TDD phases display as emoji only (🔴 🟢 🔵)
4. `/oss:*` commands automatically update workflow state via hooks
5. Visual notifications use `setMessage` instead of terminal-notifier
6. All tests pass (target: 800+ tests)

---

## Files Modified

### New Files
- `watcher/test/hooks/oss-statusline-git.test.ts`
- `watcher/test/hooks/oss-statusline-next-command.test.ts`
- `watcher/test/hooks/oss-statusline-tdd-emoji.test.ts`
- `watcher/test/hooks/oss-workflow-auto-hook.test.ts`
- `watcher/test/services/workflow-state-next-command.test.ts`
- `watcher/test/services/notification-statusline.test.ts`
- `watcher/test/cli/update-workflow-state-next-command.test.ts`
- `watcher/test/cli/update-workflow-state-current-command.test.ts`
- `hooks/oss-workflow-auto.sh`

### Modified Files
- `hooks/oss-statusline.sh`
- `watcher/src/services/workflow-state.ts`
- `watcher/src/services/notification.ts`
- `watcher/src/cli/update-workflow-state.ts`
- `watcher/test/services/notification.test.ts`
- `.claude-plugin/hooks.json`
- `commands/legend.md` (update documentation)

---

*Plan created: 2024-12-21*
*Methodology: London TDD (Outside-In)*
*Estimated tasks: 18*
*Estimated new tests: 15+*
