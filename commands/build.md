---
description: Execute TDD plans with strict RED-GREEN-REFACTOR discipline
---

# /oss:build - Write the Code

Execute your implementation plan using strict Test-Driven Development (TDD).

## What This Command Does

1. **Loads your plan** - Reads the implementation plan
2. **Executes with TDD** - RED-GREEN-REFACTOR for every task
3. **Tracks progress** - Updates plan as tasks complete
4. **Ensures quality** - No code without failing tests first

## The TDD Process (Enforced)

For EVERY task:

### RED Phase
- Write the test FIRST
- Run the test and confirm it FAILS
- Document the failure message

### GREEN Phase
- Write MINIMAL code to pass the test
- No extra features, no "while I'm here" changes
- Run test and confirm it PASSES

### REFACTOR Phase
- Clean up code while keeping tests green
- Remove duplication, improve names
- Tests must stay passing

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/shared/iron-laws
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/build
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 4: Execute the Fetched Prompt

The prompt enforces TDD discipline:
- Loads plan from `dev/active/{feature}/PLAN.md`
- Executes each task with RED-GREEN-REFACTOR
- Updates progress as tasks complete
- Reports any blockers or issues

## Command Chain (per task)

For EACH task in the plan, use these commands:
```
/oss:red       → Write failing test (mock collaborators)
    ↓
/oss:green    → Write minimal code to pass
    ↓
/oss:refactor → Clean up while green
```

After all tasks complete:
1. `/oss:integration` - Validate mock/reality alignment
2. `/oss:ship` - Quality gates + PR + merge

## Error Handling

### If API returns 401
```
Authentication failed. Run: /oss:login
```

### If API returns 403
```
Subscription expired. Upgrade at: https://www.oneshotship.com/pricing
```

### If API returns 500
```
API temporarily unavailable. Contact support@oneshotship.com
```

## Example Usage

```bash
# Execute the current plan
/oss:build

# Execute a specific phase
/oss:build --phase 2

# Execute with verbose output
/oss:build --verbose
```

## Quality Gates

The build command enforces:
- No production code without failing test first
- All tests must pass before moving to next task
- Code review checkpoints between phases
