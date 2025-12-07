---
description: Generate a TDD implementation plan with phased approach and test-first methodology
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

## Step 2: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/shared/iron-laws
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 3: Send Start Notification

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh "Creating Plan" "Designing TDD implementation plan..." "low"
```

## Step 4: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/plan
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 5: Execute the Fetched Prompt

The prompt guides creation of a TDD plan with:
- Phased implementation approach
- Test-first methodology for every task
- Clear acceptance criteria
- Dependency mapping

## Step 6: Send Completion Notification

After plan is complete:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh "Plan Ready" "TDD plan created. Ready for /oss:build" "high"
```

If planning fails:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh "Planning Failed" "Unable to create plan" "critical"
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

Creates a structured plan in `dev/active/{feature-name}/PLAN.md` with:
- Phase breakdown
- Individual tasks with test requirements
- Acceptance criteria
- Time estimates
