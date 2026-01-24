# Implementation Notes: Configurable Workflow Orchestration

## Key Insights from Prompt Analysis

### What's Currently Hardcoded

**ideate.md (lines 163-218)**:
```markdown
## After the Design - Command Chain (MANDATORY)
/oss:requirements  → User stories, acceptance criteria
/oss:api-design    → API contracts (if needed)
/oss:data-model    → Database schema (if needed)
/oss:adr           → Architecture decisions
/oss:plan          → TDD implementation plan
```

**plan.md (lines 468-523)**:
```markdown
## After the Plan - Command Chain (MANDATORY)
/oss:acceptance    → Write acceptance tests at boundary FIRST
/oss:build         → Execute TDD tasks
```

**build.md (lines 346-399)**:
```markdown
## Command Chain - Per Task (MANDATORY)
/oss:red → /oss:green → /oss:refactor (loop)
/oss:integration → /oss:contract → /oss:ship
```

**ship.md (lines 104-131)**:
```markdown
## Step 1: Run Parallel Quality Checks (4 Specialized Agents)
- code-reviewer
- performance-engineer
- security-auditor
- penetration-tester
```

### Contradiction: MANDATORY vs HARD STOP

All prompts say chains are "MANDATORY" but also have "HARD STOP" sections:

```markdown
## Phase Complete - HARD STOP
**STOP** - Do NOT auto-run `/oss:plan` or any other main phase command
```

**Resolution**: The "MANDATORY" means "if you proceed, do this sequence". The "HARD STOP" means "don't auto-proceed - wait for human". Config captures this via `checkpoint: "human"`.

---

## Implementation Gotchas

### 1. Skill vs Task for Command Invocation

Commands should be invoked via **Skill tool**:
```typescript
Skill("oss:requirements")  // Correct
```

Agents should be invoked via **Task tool**:
```typescript
Task({ subagent_type: "code-reviewer", prompt: "..." })
```

### 2. Parallel Agent Execution

For ship's 4 quality agents, must spawn in **single message**:
```typescript
// CORRECT: Single message, multiple tool calls
[Task1, Task2, Task3, Task4]

// WRONG: Sequential messages
Task1; wait; Task2; wait; ...
```

### 3. Config Validation Timing

Validate config **at load time**, not execution time:
- Catch errors early
- Fail fast with helpful messages
- Don't discover invalid agent name mid-workflow

### 4. Backward Compatibility

Default config must produce **identical behavior** to current prompts:
- Same chains in same order
- Same agents with same conditions
- Same checkpoints

Test by running workflows and comparing output.

---

## Questions to Resolve During Implementation

1. **Should conditions be evaluated at config load or execution time?**
   - Probably execution time (need context)

2. **How to handle config changes mid-session?**
   - Reload on each workflow start
   - Cache within workflow

3. **Where to store workflow state for checkpoints?**
   - `.oss/workflow-state.json` or in-memory

4. **How to surface config errors to users?**
   - CLI command: `oss config validate`
   - Hook at session start

---

## Related Files to Update

When refactoring prompts:

| File | Changes Needed |
|------|----------------|
| `commands/ideate.md` | Remove lines 163-218 (chain section) |
| `commands/plan.md` | Remove lines 468-523 (chain section) |
| `commands/build.md` | Remove lines 346-399 (chain section) |
| `commands/ship.md` | Remove lines 104-131 (agent list) |

Keep educational content about TDD cycle, quality gates, etc.
Remove hardcoded command/agent references.
