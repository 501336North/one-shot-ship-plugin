---
name: plan
description: Create TDD implementation plan with behavioral tests mapped to acceptance criteria
---

# OSS Plan

Create comprehensive TDD implementation plans with world-class CI/CD setup.

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss login
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

Execute the prompt returned by the API. The prompt will:
- Set up world-class CI/CD infrastructure
- Create TDD implementation plans
- Map tasks to acceptance criteria
- Define RED-GREEN-REFACTOR cycles

## Error Handling

### If API returns 401
```
Authentication failed. Run: /oss login
```

### If API returns 403
```
Subscription expired. Upgrade at: https://www.oneshotship.com/pricing
```

### If API returns 500
```
API temporarily unavailable. Contact support@oneshotship.com
```
