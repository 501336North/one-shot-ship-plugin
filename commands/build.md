---
description: Execute TDD plans with strict RED-GREEN-REFACTOR discipline
estimated_tokens: 5000-15000
---

## Help

**Command:** `/oss:build`

**Description:** Execute your implementation plan using strict Test-Driven Development (TDD) with RED-GREEN-REFACTOR discipline.

**Workflow Position:** ideate → plan → **BUILD** → ship

**Usage:**
```bash
/oss:build [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | - | Loads plan from `.oss/dev/active/{feature}/PLAN.md` |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--phase` | `-p` | Execute a specific phase number (e.g., `--phase 2`) |
| `--verbose` | `-v` | Enable verbose output with detailed logging |

**Examples:**
```bash
# Execute the current plan
/oss:build

# Execute a specific phase
/oss:build --phase 2

# Execute with verbose output
/oss:build --verbose

# Show help
/oss:build --help
```

**Related Commands:**
- `/oss:plan` - Run before to create the implementation plan
- `/oss:red` - Write failing test (granular TDD step)
- `/oss:green` - Write minimal code to pass (granular TDD step)
- `/oss:refactor` - Clean up code (granular TDD step)
- `/oss:integration` - Validate mocks match reality after build
- `/oss:ship` - Quality check, commit, and create PR after build

---

# /oss:build - Write the Code

Execute your implementation plan using strict Test-Driven Development (TDD).

## What This Command Does

1. **Loads your plan** - Reads the implementation plan
2. **Executes with TDD** - RED-GREEN-REFACTOR for every task
3. **Tracks progress** - Updates plan as tasks complete
4. **Ensures quality** - No code without failing tests first

## The TDD Process (Enforced)

For EVERY task, you MUST follow this exact sequence with logging:

### RED Phase
1. **Log RED start:**
   ```bash
   ~/.oss/hooks/oss-log.sh phase build RED start
   ```
2. Write the test FIRST
3. Run the test and confirm it FAILS
4. Document the failure message
5. **Log RED complete:**
   ```bash
   ~/.oss/hooks/oss-log.sh phase build RED complete
   ~/.oss/hooks/oss-log.sh test build FAIL "{test_file}: {failure_message}"
   ```

### GREEN Phase
1. **Log GREEN start:**
   ```bash
   ~/.oss/hooks/oss-log.sh phase build GREEN start
   ```
2. Write MINIMAL code to pass the test
3. No extra features, no "while I'm here" changes
4. Run test and confirm it PASSES
5. **Log GREEN complete:**
   ```bash
   ~/.oss/hooks/oss-log.sh phase build GREEN complete
   ~/.oss/hooks/oss-log.sh test build PASS "{test_file}"
   ```

### REFACTOR Phase
1. **Log REFACTOR start:**
   ```bash
   ~/.oss/hooks/oss-log.sh phase build REFACTOR start
   ```
2. Clean up code while keeping tests green
3. Remove duplication, improve names
4. Run tests - they MUST stay passing
5. **Log REFACTOR complete:**
   ```bash
   ~/.oss/hooks/oss-log.sh phase build REFACTOR complete
   ```

### Agent Delegation Logging
When delegating to specialized agents (Task tool), you MUST log:
```bash
# Before spawning agent
~/.oss/hooks/oss-log.sh agent build {agent_type} "starting: {task_description}"

# After agent completes
~/.oss/hooks/oss-log.sh agent build {agent_type} "completed: {result_summary}"
```

**CRITICAL**: Do NOT batch multiple TDD cycles into a single agent delegation. Each RED-GREEN-REFACTOR cycle must be logged individually.

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Initialize Logging

**You MUST initialize logging for supervisor visibility.**

```bash
~/.oss/hooks/oss-log.sh init build
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```bash
~/.oss/hooks/fetch-iron-laws.sh
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 4: Update Status Line (Start)

```bash
~/.oss/hooks/oss-notify.sh --workflow build start '{"totalTasks": {TASK_COUNT}}'
```

**You MUST update the workflow status before proceeding.**

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name build
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt enforces TDD discipline:
- Loads plan from `.oss/dev/active/{feature}/PLAN.md` (project-local or global fallback)
- Executes each task with RED-GREEN-REFACTOR
- Updates progress as tasks complete
- Reports any blockers or issues

## Step 7: Update Status Line (Progress)

**You MUST update the workflow status at the appropriate moments.**

After each task completes:
```bash
~/.oss/hooks/oss-notify.sh --workflow build task_complete '{"current": {N}, "total": {TOTAL}, "taskName": "{TASK_NAME}"}'
```

After all tasks complete:
```bash
~/.oss/hooks/oss-notify.sh --workflow build complete '{"testsPass": {TEST_COUNT}, "duration": "{DURATION}"}'
```

> Note: IRON LAW compliance checklist is automatically logged on `complete` events.

If build fails:
```bash
~/.oss/hooks/oss-notify.sh --workflow build failed '{"failedTest": "{TEST_FILE}:{LINE}"}'
```

## Command Chain (per task)

For EACH task in the plan, execute the TDD cycle with full logging:

```
┌─────────────────────────────────────────────────────────────────┐
│ For EACH test in the task:                                      │
├─────────────────────────────────────────────────────────────────┤
│ 1. LOG: oss-log.sh phase build RED start                       │
│ 2. Write the failing test                                       │
│ 3. Run test - MUST FAIL                                        │
│ 4. LOG: oss-log.sh phase build RED complete                    │
│ 5. LOG: oss-log.sh test build FAIL "test.ts: error msg"        │
├─────────────────────────────────────────────────────────────────┤
│ 6. LOG: oss-log.sh phase build GREEN start                     │
│ 7. Write MINIMAL code to pass                                   │
│ 8. Run test - MUST PASS                                        │
│ 9. LOG: oss-log.sh phase build GREEN complete                  │
│ 10. LOG: oss-log.sh test build PASS "test.ts"                  │
├─────────────────────────────────────────────────────────────────┤
│ 11. LOG: oss-log.sh phase build REFACTOR start                 │
│ 12. Clean up (if needed)                                        │
│ 13. Run test - MUST STILL PASS                                 │
│ 14. LOG: oss-log.sh phase build REFACTOR complete              │
└─────────────────────────────────────────────────────────────────┘
```

**Expected log output for each TDD cycle:**
```
[HH:MM:SS] [PHASE] RED start
[HH:MM:SS] [PHASE] RED complete
[HH:MM:SS] [TEST] FAIL - test/foo.test.ts: expected X but got Y
[HH:MM:SS] [PHASE] GREEN start
[HH:MM:SS] [PHASE] GREEN complete
[HH:MM:SS] [TEST] PASS - test/foo.test.ts
[HH:MM:SS] [PHASE] REFACTOR start
[HH:MM:SS] [PHASE] REFACTOR complete
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

## Long-Running Operations

> **Tip**: Multi-phase builds with many TDD cycles can take time.
> Press **Ctrl+B** to move the build to the background.
> You'll be notified when it completes and can continue other work.

## Quality Gates

The build command enforces:
- No production code without failing test first
- All tests must pass before moving to next task
- Code review checkpoints between phases
