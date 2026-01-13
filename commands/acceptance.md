---
description: Write acceptance tests at system boundaries (Outside-In first tests)
---

# /oss:acceptance - Write Acceptance Tests

Write acceptance tests at system boundaries (Outside-In TDD).

## What This Command Does

1. **Identifies boundaries** - API endpoints, UI entry points
2. **Writes acceptance test** - High-level user behavior test
3. **Mocks collaborators** - Isolates system under test
4. **Verifies failure** - Test must fail meaningfully

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init acceptance
```

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow acceptance start '{}'
```

## Step 4: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type commands --name acceptance
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 5: Execute the Fetched Prompt

The prompt guides you through:
- Identifying system boundaries
- Writing high-level acceptance tests
- Setting up mock collaborators
- Verifying meaningful test failure

## Step 6: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

On success (acceptance test written and fails as expected):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow acceptance complete '{"testFile": "{TEST_FILE}", "testsWritten": {COUNT}}'
```

On failure (couldn't write acceptance test):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow acceptance failed '{"reason": "{REASON}"}'
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

## Playwright for UI Acceptance Tests

When the feature involves web UI, generate Playwright acceptance tests:

**Detection keywords**: page, form, button, click, modal, navigation, UI, frontend

**Generated test format (Given/When/Then):**
```typescript
import { test, expect } from '@playwright/test';

test.describe('User Registration', () => {
  test('should register new user with valid credentials', async ({ page }) => {
    // Given I am on the registration page
    await page.goto('/register');

    // When I fill in valid credentials
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.fill('[data-testid="password"]', 'SecurePass123!');
    await page.click('[data-testid="submit"]');

    // Then I should see the dashboard
    await expect(page).toHaveURL('/dashboard');
  });
});
```

**Best practices:**
- Use `data-testid` selectors (resilient to CSS changes)
- Follow Given/When/Then structure
- One assertion per test

## Example Usage

```bash
/oss:acceptance "As a user, I can login with email and password"
/oss:acceptance --story US-123
```
