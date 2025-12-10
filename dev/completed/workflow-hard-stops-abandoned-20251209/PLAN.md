# Workflow Hard Stops - Implementation Plan

## Problem Statement

The 4 main workflow commands (ideate, plan, build, ship) are designed to be self-contained phases that should stop and wait for human initiation of the next phase. However, agents currently auto-chain to the next phase because:

1. Command Chain sections in plugin wrappers say "execute these commands in sequence"
2. API prompts contain "execute continuously" and "complete entire plan" language
3. No explicit boundary enforcement exists

## Desired Behavior

```
Human: /oss:ideate
Agent: [completes ideation]
Agent: HARD STOP - outputs "Run /oss:plan when ready"
[Agent waits - does NOT auto-run /oss:plan]
```

**What IS allowed (auto-chaining WITHIN a phase):**
- `build` auto-runs all RED-GREEN-REFACTOR cycles for all tasks
- `build` auto-runs quality gates (lint, test, typecheck)
- `ship` auto-runs quality gates, commit, PR creation
- Sub-commands like `/oss:red -> /oss:green -> /oss:refactor` within build

**What is NOT allowed (crossing phase boundaries):**
- `ideate` completing and auto-running `plan`
- `plan` completing and auto-running `build`
- `build` completing and auto-running `ship`

## Solution Design

### Option Analysis

| Location | Pros | Cons |
|----------|------|------|
| IRON LAWS (API) | Single source of truth, authoritative | Requires API deployment |
| Plugin Commands | Easy to update, fast deploy | Less authoritative |
| API Prompts | Controls behavior, IP protected | 4 prompts to update |
| All Three | Defense in depth | More maintenance |

### Chosen Approach: IRON LAW #7 + Plugin Command Updates

**Why:**
1. IRON LAWS are fetched at start of every command - authoritative
2. Plugin commands provide immediate reinforcement
3. Clear, non-negotiable rule that agents must follow

## Implementation Phases

### Phase 1: Add IRON LAW #7 (API)

**Files to modify:**
- `packages/api/src/prompts/iron-laws.ts` (or wherever IRON LAWS are stored)

**New IRON LAW #7: Workflow Phase Boundaries**

```markdown
## IRON LAW #7: Workflow Phase Boundaries (MANDATORY)

The 4 main workflow phases are SELF-CONTAINED and must HARD STOP at completion:

| Phase | Command | MUST STOP After | Next Phase (Human Initiated) |
|-------|---------|-----------------|------------------------------|
| 1. Ideate | /oss:ideate | Design doc complete | Human runs /oss:plan |
| 2. Plan | /oss:plan | PLAN.md written | Human runs /oss:build |
| 3. Build | /oss:build | All tasks + quality gates | Human runs /oss:ship |
| 4. Ship | /oss:ship | PR merged | Workflow complete |

**HARD STOP means:**
- Output completion message with next command hint
- DO NOT execute the next phase command
- DO NOT ask "should I continue to X?"
- WAIT for human to explicitly run the next command

**Auto-chaining WITHIN a phase IS allowed:**
- build: Execute all tasks, all RED-GREEN-REFACTOR cycles, all quality gates
- ship: Execute all quality checks, commit, PR, merge (if --merge)
- Sub-commands: /oss:red -> /oss:green -> /oss:refactor

**Completion Output Format:**
After each phase completes, output EXACTLY:

ideate: "Design complete. Run /oss:plan when ready."
plan: "Plan complete. Run /oss:build when ready."
build: "Build complete. Run /oss:ship when ready."
ship: "Shipped! Workflow complete."

**Self-Correction:** If you find yourself about to run the next phase command automatically, STOP and output the completion message instead.
```

### Phase 2: Update Plugin Command Wrappers

**Files to modify:**
- `commands/ideate.md`
- `commands/plan.md`
- `commands/build.md`
- `commands/ship.md`

**Changes:**
1. Remove/Reword "Command Chain" sections that say "execute in sequence"
2. Add explicit HARD STOP instruction at end
3. Change completion output to include next command hint (not auto-execution)

**Example update for ideate.md:**

Before:
```markdown
## Command Chain (after ideation complete)

After ideation is complete, execute these commands in sequence:
1. /oss:requirements...
5. /oss:plan
```

After:
```markdown
## Completion (HARD STOP)

After ideation is complete:
1. Output the design document
2. Output: "Design complete. Run /oss:plan when ready."
3. STOP - Do NOT auto-run /oss:plan or any other command
4. Wait for human to initiate next phase

**The next phase (/oss:plan) must be initiated by the human.**
```

### Phase 3: Update API Prompts (Defense in Depth)

**Files to modify:**
- `packages/api/src/prompts/ideate.ts`
- `packages/api/src/prompts/plan.ts`
- `packages/api/src/prompts/build.ts`
- `packages/api/src/prompts/ship.ts`

**Changes:**
1. Add explicit HARD STOP instruction at end of each prompt
2. Ensure completion output format matches IRON LAW #7
3. Remove any "continue to next phase" language

### Phase 4: Add Tests for Enforcement

**Files to create:**
- `watcher/test/workflow-boundaries.test.ts`

**Tests:**
1. Verify IRON LAW #7 content is served from API
2. Verify each command outputs correct completion message
3. Verify no auto-chaining occurs between phases

## Task Breakdown (TDD)

### Task 1.1: Add IRON LAW #7 to API
- **RED**: Test that GET /api/v1/prompts/shared/iron-laws includes "IRON LAW #7"
- **GREEN**: Add the law content to iron-laws response
- **REFACTOR**: Ensure formatting consistency

### Task 1.2: Update ideate.md command wrapper
- **RED**: N/A (markdown file, no executable test)
- **GREEN**: Update Command Chain section to HARD STOP
- **REFACTOR**: Ensure consistent formatting

### Task 1.3: Update plan.md command wrapper
- **GREEN**: Update Command Chain section to HARD STOP

### Task 1.4: Update build.md command wrapper
- **GREEN**: Update Command Chain section to HARD STOP

### Task 1.5: Update ship.md command wrapper (if needed)
- **GREEN**: Verify completion message is correct

### Task 2.1: Update ideatePrompt in API
- **RED**: Test completion message format
- **GREEN**: Add HARD STOP instruction to prompt
- **REFACTOR**: Clean up

### Task 2.2: Update planPrompt in API
- **GREEN**: Add HARD STOP instruction

### Task 2.3: Update buildPrompt in API
- **GREEN**: Add HARD STOP instruction

### Task 2.4: Update shipPrompt in API (verify)
- **GREEN**: Verify correct completion

### Task 3.1: Add workflow boundary tests
- **RED**: Write tests for enforcement
- **GREEN**: Implement
- **REFACTOR**: Clean up

## Estimated Effort

| Phase | Tasks | Effort |
|-------|-------|--------|
| Phase 1: IRON LAW | 1 task | Low |
| Phase 2: Plugin Commands | 4 tasks | Low |
| Phase 3: API Prompts | 4 tasks | Medium |
| Phase 4: Tests | 1 task | Low |

**Total: 10 tasks across 2 repos (plugin + API)**

## Metadata

- **Created**: 2024-12-09
- **Status**: Ready for Implementation
- **Repos**: one-shot-ship-plugin, AgenticDevWorkflow