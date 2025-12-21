---
description: Extract user stories and acceptance criteria from ideas
---

# /oss:requirements - Extract Requirements

Transform vague ideas into structured user stories with acceptance criteria.

## What This Command Does

1. **Analyzes input** - Parses ideas, PRDs, or feature descriptions
2. **Extracts user stories** - Who/What/Why format
3. **Defines acceptance criteria** - Testable conditions
4. **Identifies edge cases** - Error scenarios, boundary conditions

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init requirements
```

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow requirements start '{}'
```

## Step 4: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/requirements
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 5: Execute the Fetched Prompt

The prompt guides you through:
- Parsing input for key requirements
- Creating user stories in standard format
- Defining testable acceptance criteria
- Documenting edge cases and error scenarios

## Step 6: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

On success (requirements extracted):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow requirements complete '{"storiesCount": {COUNT}, "criteriaCount": {CRITERIA}}'
```

On failure (couldn't extract requirements):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow requirements failed '{"reason": "{REASON}"}'
```

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
/oss:requirements "users should be able to share files with each other"
/oss:requirements --from prd.md
```
