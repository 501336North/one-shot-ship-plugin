---
description: Clean up code while keeping tests green (London TDD REFACTOR phase)
---

# /oss:refactor - Clean Up the Code

Improve code quality while keeping all tests passing.

## What This Command Does

1. **Identifies opportunities** - Finds code smells
2. **Applies refactoring** - Safely improves code
3. **Runs tests** - After every change
4. **Maintains green** - Tests stay passing

## The REFACTOR Phase (London TDD)

- Remove duplication
- Improve names and structure
- Extract methods/classes
- Run tests after EVERY change

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
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/refactor
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt guides you through:
- Identifying refactoring opportunities
- Applying safe transformations
- Running tests continuously
- Improving code quality metrics

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
# Refactor current working code
/oss:refactor

# Refactor specific file
/oss:refactor src/services/auth.ts

# Refactor with specific pattern
/oss:refactor --pattern "extract-method"
```
