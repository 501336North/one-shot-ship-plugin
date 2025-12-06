---
description: Write failing test first, design interfaces through mocks (London TDD RED phase)
---

# /oss:red - Write the Failing Test

Start the London TDD cycle by writing a failing test that designs interfaces through mocks.

## What This Command Does

1. **Analyzes requirements** - Understands what to test
2. **Designs interfaces** - Through mock expectations
3. **Writes failing test** - At system boundary
4. **Verifies failure** - Confirms meaningful assertion error

## The RED Phase (London TDD)

- Start at system boundary (API, UI)
- Mock all collaborators
- Design interface through mock expectations
- Test MUST fail with meaningful error

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
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/red
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt guides you through:
- Understanding the feature requirement
- Identifying the system boundary
- Creating mocks for collaborators
- Writing the failing test
- Verifying meaningful failure

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
# Start RED phase for a feature
/oss:red user authentication

# RED phase for specific behavior
/oss:red "users can reset password via email"
```
