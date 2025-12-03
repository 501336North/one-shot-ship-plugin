---
description: Run comprehensive E2E tests across critical user journeys
---

# /oss:test - Run E2E Tests

Run comprehensive E2E tests across critical user journeys.

## What This Command Does

1. **Identifies user flows** - Critical paths through the application
2. **Generates E2E tests** - Playwright/Cypress test suites
3. **Runs tests** - Executes against staging/local
4. **Reports results** - Detailed pass/fail analysis

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

## Step 2: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/test
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt handles:
- User flow identification
- Test generation
- Test execution
- Results reporting

## Example Usage

```bash
/oss:test
/oss:test --flow checkout
```
