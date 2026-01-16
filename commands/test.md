---
description: Run comprehensive E2E tests across critical user journeys
---

## Help

**Command:** `/oss:test`

**Description:** Run comprehensive E2E tests across critical user journeys

**Workflow Position:** build -> **TEST** -> ship

**Usage:**
```bash
/oss:test [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--flow` | | Specific user flow to test (e.g., checkout) |

**Examples:**
```bash
# Run all E2E tests
/oss:test

# Run tests for a specific user flow
/oss:test --flow checkout
```

**Related Commands:**
- `/oss:build` - Build phase that precedes testing
- `/oss:ship` - Ship after tests pass
- `/oss:smoke` - Post-deployment smoke testing
- `/oss:integration` - Validate mocked interactions

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

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Initialize Logging

**You MUST initialize logging for supervisor visibility.**

```bash
~/.oss/hooks/oss-log.sh init test
```

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/test
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Detect Test Frameworks

Before running tests, detect which frameworks are available:

```bash
# Detect Playwright
PLAYWRIGHT_RESULT=$(~/.oss/hooks/oss-detect-playwright.sh)
HAS_PLAYWRIGHT=$(echo "$PLAYWRIGHT_RESULT" | jq -r '.detected')
```

## Step 4: Execute Tests

### Unit/Integration Tests
Run the primary test suite:
```bash
npm test
```

### Playwright E2E Tests (if detected)
If Playwright is configured in the project:
```bash
npx playwright test --reporter=list
```

**Browser Coverage Reporting:**
```
Unit Tests: 50/50 passed
E2E Tests:  12/12 passed
├─ Chromium: ✓ 12 passed
├─ Firefox:  ✓ 12 passed
└─ WebKit:   ✓ 12 passed
```

## Step 5: Execute the Fetched Prompt

The prompt handles:
- User flow identification
- Test generation
- Test execution
- Results reporting

## Long-Running Operations

> **Tip**: E2E tests can take several minutes to complete.
> Press **Ctrl+B** to move this operation to the background.
> You'll be notified when it completes and can continue other work.

## Example Usage

```bash
/oss:test
/oss:test --flow checkout
```
