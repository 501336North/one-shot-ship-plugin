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

## Step 2: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/plan
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt guides creation of a TDD plan with:
- Phased implementation approach
- Test-first methodology for every task
- Clear acceptance criteria
- Dependency mapping

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
