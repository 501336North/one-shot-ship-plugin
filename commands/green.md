---
description: Write minimal code to pass tests (London TDD GREEN phase)
---

# /oss:green - Make the Test Pass

Write the minimal implementation to make failing tests pass.

## What This Command Does

1. **Analyzes failing test** - Understands what's needed
2. **Extracts mock expectations** - What behavior is expected
3. **Writes minimal code** - Just enough to pass
4. **Verifies success** - Confirms test passes

## The GREEN Phase (London TDD)

- Only enough code to satisfy the test
- No extra features
- No "while I'm here" changes
- Implementation satisfies mock expectations

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
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/green
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt guides you through:
- Analyzing the failing test
- Understanding mock expectations
- Writing minimal implementation
- Running tests to confirm GREEN

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
# Make the current failing test pass
/oss:green

# GREEN phase for specific test file
/oss:green src/auth/login.test.ts
```
