---
description: Write acceptance tests at system boundaries (Outside-In first tests)
---

## Help

**Command:** `/oss:acceptance`

**Description:** Write acceptance tests at system boundaries (Outside-In TDD).

**Workflow Position:** plan → **ACCEPTANCE** → build: [ red → green → refactor ] → integration → ship

**Usage:**
```bash
/oss:acceptance [OPTIONS] [FEATURE]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `FEATURE` | No | Feature to write acceptance test for |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--boundary` | `-b` | Specify boundary type: api, ui, cli |

**Examples:**
```bash
# Write acceptance test for a feature
/oss:acceptance "user login"

# Specify boundary type
/oss:acceptance "checkout flow" --boundary api

# Show help
/oss:acceptance --help
```

**Related Commands:**
- `/oss:plan` - Run before to create implementation plan
- `/oss:red` - Start the TDD cycle after acceptance test
- `/oss:build` - Full TDD loop orchestrator
- `/oss:requirements` - Extract user stories for acceptance criteria

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
test -f "$HOME/.oss/config.json" && grep -qE '"apiKey"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]' "$HOME/.oss/config.json" && echo "API key configured"
```

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Initialize Logging

**You MUST initialize logging for supervisor visibility.**

```bash
~/.oss/hooks/oss-log.sh init acceptance
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow acceptance start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type commands --name acceptance
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line what happened (rate limited, offline, or not logged in, so run /oss:login) and STOP this command; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt guides you through:
- Identifying system boundaries
- Writing high-level acceptance tests
- Setting up mock collaborators
- Verifying meaningful test failure

## Step 7: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

On success (acceptance test written and fails as expected):
```bash
~/.oss/hooks/oss-notify.sh --workflow acceptance complete '{}'
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
