---
description: Generate a TDD implementation plan with phased approach and test-first methodology
---

## Help

**Command:** `/oss:plan`

**Description:** Create a comprehensive TDD implementation plan for your feature or project.

**Workflow Position:** ideate → **PLAN** → build → ship

**Usage:**
```bash
/oss:plan [OPTIONS] [FEATURE]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `FEATURE` | No | Feature or project to plan (uses ideation output if not specified) |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Plan a specific feature
/oss:plan "implement user dashboard"

# Plan based on previous ideation
/oss:plan

# Show help
/oss:plan --help
```

**Related Commands:**
- `/oss:ideate` - Run before to transform ideas into requirements
- `/oss:acceptance` - Write acceptance tests at system boundary FIRST
- `/oss:build` - Execute TDD tasks from the plan
- `/oss:adr` - Record architecture decisions made during planning

---

# /oss:plan - Generate Architecture

Create a comprehensive TDD implementation plan for your feature or project.

## What This Command Does

1. **Analyzes requirements** - Understands what needs to be built
2. **Designs architecture** - Creates a phased implementation approach
3. **Defines test strategy** - Every task starts with tests
4. **Produces actionable plan** - Step-by-step implementation guide

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
~/.oss/hooks/oss-log.sh init plan
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/shared/iron-laws
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 4: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow plan start '{}'
```

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name plan
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt guides creation of a TDD plan with:
- Phased implementation approach
- Test-first methodology for every task
- Clear acceptance criteria
- Dependency mapping

## Step 7: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

After plan is complete:
```bash
~/.oss/hooks/oss-notify.sh --workflow plan complete '{"taskCount": {TASK_COUNT}, "phases": {PHASE_COUNT}}'
```

> Note: IRON LAW compliance checklist is automatically logged on `complete` events.

If planning fails:
```bash
~/.oss/hooks/oss-notify.sh --workflow plan failed '{}'
```

## Command Chain (after planning complete)

After the plan is approved, execute these commands in sequence:
1. `/oss:acceptance` - Write acceptance tests at system boundary FIRST
2. `/oss:build` - Execute TDD tasks (red → green → refactor)

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
# Plan a specific feature
/oss:plan "implement user dashboard"

# Plan based on previous ideation
/oss:plan
```

## Output

Creates a structured plan in `.oss/dev/active/{feature-name}/PLAN.md` (project-local) with:
- Phase breakdown
- Individual tasks with test requirements
- Acceptance criteria
- Time estimates
