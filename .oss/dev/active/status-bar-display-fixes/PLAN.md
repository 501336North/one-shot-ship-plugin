# TDD Implementation Plan: Status Bar Display Fixes

## Problem Statement

Two bugs were reported in the status bar display:

### Issue #1: Missing Model and Project Info
**Observed:** `✅ | 🌿 feat/agent-status-bar-command-display | → build`
**Expected:** `✅ | [Opus 4.5] AgenticDevWorkflow | 🌿 feat/agent-status-bar-command-display | → build`

The `[Model] Project` section is missing when in idle state. The status line shows model/project info only in "active" state (when `currentCommand` or `activeAgent` or `tddPhase` is set) but hides it in idle state.

**Root Cause:** In `oss-statusline.sh:438-447`, the `is_idle_state()` check triggers minimal display mode which deliberately omits the model/project section.

### Issue #2: Confusing "build → build" Display
**Observed:** `build → build`
**Expected:** `build → ship` (current command → next command in sequence)

When a command completes, the display should show `last_command → next_command` where the sequence is:
- `ideate → plan`
- `plan → build`
- `build → ship`
- `ship → DONE`

**Root Cause:** The `oss-notify.sh:176-178` calls `setActiveStep` on workflow start, which sets `currentCommand` to the command being started. But on complete (line 191), it calls `completeStep` which clears `activeStep` but doesn't clear `currentCommand`. So `currentCommand` stays as "build" while `nextCommand` is calculated as "build" (wrong - should be "ship").

## Root Cause Analysis

### Issue #1: Minimal Idle Display
Location: `/Users/ysl/dev/one-shot-ship-plugin/hooks/oss-statusline.sh`

```bash
# Lines 438-447 - Idle state shows minimal display
if is_idle_state; then
    # Minimal idle display: health | branch | → next (if available)
    [[ -n "$health" ]] && sections+=("$health")
    [[ -n "$branch" ]] && sections+=("$branch")
    [[ -n "$workflow" ]] && sections+=("$workflow")  # Will be "→ next" or empty
    # ...
else
    # Full active display includes model_project
    [[ -n "$model_project" ]] && sections+=("$model_project")
    # ...
fi
```

**Fix:** Always include model/project info regardless of idle state.

### Issue #2: Command Flow Logic
Location: `/Users/ysl/dev/one-shot-ship-plugin/watcher/src/services/workflow-state.ts`

```typescript
// Lines 247-256 - completeStep sets nextCommand but not currentCommand
async completeStep(step: ChainStep): Promise<void> {
    const state = await this.getState();
    state.chainState[chainKey] = 'done';
    state.activeStep = null;
    // Sets nextCommand based on completed step
    const NEXT_COMMAND_MAP = { ideate: 'plan', plan: 'build', build: 'ship', ship: null };
    state.nextCommand = NEXT_COMMAND_MAP[step];
    // BUG: currentCommand is NOT cleared here!
}
```

And in `oss-notify.sh:176-178`:
```bash
case "$WORKFLOW_EVENT" in
    start)
        node "$WORKFLOW_STATE_CLI" setActiveStep "$WORKFLOW_CMD"  # Sets activeStep
        node "$WORKFLOW_STATE_CLI" setSupervisor watching
        # BUG: Doesn't set currentCommand explicitly!
```

**Fix:**
1. On `start`: Set `currentCommand` to the command name
2. On `complete`: Clear `currentCommand` (or set to null)
3. Display should show `currentCommand → nextCommand` when both exist

## Implementation Plan

### Phase 1: Fix Status Line Display (oss-statusline.sh)

#### Task 1.1: Always Show Model/Project Info
**Test:** Status line includes model/project section even in idle state
**File:** `hooks/oss-statusline.sh`
**Change:** Remove conditional that hides model/project in idle mode

```bash
# Before (lines 438-447):
if is_idle_state; then
    [[ -n "$health" ]] && sections+=("$health")
    [[ -n "$branch" ]] && sections+=("$branch")
    # Missing: model_project
else
    [[ -n "$health" ]] && sections+=("$health")
    [[ -n "$model_project" ]] && sections+=("$model_project")
    # ...
fi

# After:
# Always show these core sections
[[ -n "$health" ]] && sections+=("$health")
[[ -n "$model_project" ]] && sections+=("$model_project")
[[ -n "$branch" ]] && sections+=("$branch")
[[ -n "$workflow" ]] && sections+=("$workflow")
# Only show these in active state
if ! is_idle_state; then
    [[ -n "$agent" ]] && sections+=("$agent")
    [[ -n "$supervisor" ]] && sections+=("$supervisor")
fi
# Always show queue alerts and notifications
if [[ -n "$queue" && "$queue" == *"🚨"* ]]; then
    sections+=("$queue")
fi
[[ -n "$notification" ]] && sections+=("$notification")
```

### Phase 2: Fix Workflow State Management (workflow-state.ts)

#### Task 2.1: Set currentCommand on Workflow Start
**Test:** When setActiveStep is called, currentCommand should be set to the major workflow command
**File:** `watcher/src/services/workflow-state.ts`
**Change:** In `setActiveStep()`, also set `currentCommand` to the major workflow stage

```typescript
// Map step to its major command for display
const STEP_TO_COMMAND: Record<string, string> = {
  ideate: 'ideate',
  requirements: 'ideate',
  apiDesign: 'ideate',
  dataModel: 'ideate',
  adr: 'ideate',
  plan: 'plan',
  acceptance: 'build',
  red: 'build',
  mock: 'build',
  green: 'build',
  refactor: 'build',
  integration: 'build',
  contract: 'build',
  ship: 'ship',
  build: 'build',
};

async setActiveStep(step: ChainStep): Promise<void> {
  // ... existing code ...

  // Set currentCommand based on which major workflow stage this step belongs to
  state.currentCommand = STEP_TO_COMMAND[step] || step;

  await this.writeState(state);
}
```

#### Task 2.2: Clear currentCommand on Step Completion
**Test:** When completeStep is called, currentCommand should be cleared
**File:** `watcher/src/services/workflow-state.ts`

```typescript
async completeStep(step: ChainStep): Promise<void> {
  const state = await this.getState();
  state.chainState[chainKey] = 'done';
  state.activeStep = null;

  // Clear currentCommand since step is complete
  delete state.currentCommand;

  // Set nextCommand based on which step was completed
  const NEXT_COMMAND_MAP = { ideate: 'plan', plan: 'build', build: 'ship', ship: null };
  state.nextCommand = NEXT_COMMAND_MAP[step];

  await this.writeState(state);
}
```

### Phase 3: Fix Display Logic (oss-statusline.sh)

#### Task 3.1: Handle "DONE" State After Ship Completes
**Test:** When ship completes, nextCommand is null - display should show "→ DONE" or just be empty
**File:** `hooks/oss-statusline.sh`

```bash
# In compute_workflow()
# Priority 3: Next command suggestion (idle state)
if [[ -n "$next_cmd" && "$next_cmd" != "null" ]]; then
    echo "→ $next_cmd"
    return
fi

# If no next command and ship was the last completed step, show DONE
# Check chainState.ship == "done" and all major steps done
local ship_status
ship_status=$(echo "$STATE" | jq -r '.chainState.ship // ""' 2>/dev/null)
if [[ "$ship_status" == "done" ]]; then
    echo "✓ DONE"
    return
fi
```

## Test Strategy

### Unit Tests (workflow-state.test.ts)

1. **Test: setActiveStep sets currentCommand**
   - Given: Empty state
   - When: setActiveStep('build') is called
   - Then: state.currentCommand === 'build'

2. **Test: completeStep clears currentCommand and sets nextCommand**
   - Given: state with currentCommand='build'
   - When: completeStep('build') is called
   - Then: state.currentCommand === undefined AND state.nextCommand === 'ship'

3. **Test: completeStep('ship') sets nextCommand to null**
   - Given: state with currentCommand='ship'
   - When: completeStep('ship') is called
   - Then: state.nextCommand === null

### Integration Tests (oss-statusline.sh)

1. **Test: Idle state shows model/project**
   - Given: workflow-state.json with no activeStep, no currentCommand
   - When: oss-statusline.sh runs
   - Then: Output includes "[Opus 4.5] ProjectName"

2. **Test: Active state shows current → next**
   - Given: workflow-state.json with currentCommand='build', nextCommand='ship'
   - When: oss-statusline.sh runs
   - Then: Output includes "build → ship"

3. **Test: Completed workflow shows DONE**
   - Given: workflow-state.json with chainState.ship='done', nextCommand=null
   - When: oss-statusline.sh runs
   - Then: Output includes "✓ DONE" or no workflow section

## Files to Modify

1. `/Users/ysl/dev/one-shot-ship-plugin/hooks/oss-statusline.sh`
   - Remove conditional that hides model/project in idle state
   - Add DONE state handling

2. `/Users/ysl/dev/one-shot-ship-plugin/watcher/src/services/workflow-state.ts`
   - setActiveStep: Set currentCommand
   - completeStep: Clear currentCommand

3. `/Users/ysl/dev/one-shot-ship-plugin/watcher/test/services/workflow-state.test.ts`
   - Add tests for currentCommand behavior

## Sequence: ideate → plan → build → ship → DONE

| Command | On Start | On Complete | Display During | Display After |
|---------|----------|-------------|----------------|---------------|
| ideate | currentCommand='ideate' | nextCommand='plan' | ideate | → plan |
| plan | currentCommand='plan' | nextCommand='build' | plan | → build |
| build | currentCommand='build' | nextCommand='ship' | build | → ship |
| ship | currentCommand='ship' | nextCommand=null | ship | ✓ DONE |

## Acceptance Criteria

- [ ] Model and project info always visible (even in idle state)
- [ ] During command execution: shows `currentCommand` (e.g., `build`)
- [ ] After command completion: shows `→ nextCommand` (e.g., `→ ship`)
- [ ] After ship completes: shows `✓ DONE` or clears workflow section
- [ ] Never shows `build → build` (currentCommand should be cleared on complete)

## Priority

High - This affects core UX and user understanding of workflow state.
