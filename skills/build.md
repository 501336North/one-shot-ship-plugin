---
name: build
description: Execute implementation plans with TDD (RED-GREEN-REFACTOR). Use for coding and implementation.
---

# OSS Build

Execute implementation plans with strict TDD methodology.

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
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/build
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt orchestrates TDD execution:
- RED: Write failing test first
- GREEN: Implement minimal code to pass
- REFACTOR: Clean up while keeping tests green

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

## Example Usage

```
/oss build
```

Executes the current plan with TDD enforcement.
