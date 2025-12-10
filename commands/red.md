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

## Step 2: Initialize Logging and Log Phase Start

**You MUST initialize logging and log the RED phase start for supervisor visibility.**

```bash
# Initialize command log
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init red

# Log TDD phase start (MANDATORY)
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh phase red RED start
```

## Step 3: Send Start Notification

**You MUST execute this notification command before proceeding.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow red start '{}'
```

## Step 4: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/red
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 4: Execute the Fetched Prompt

The prompt guides you through:
- Understanding the feature requirement
- Identifying the system boundary
- Creating mocks for collaborators
- Writing the failing test
- Verifying meaningful failure

## Step 5: Log Phase Complete and Send Notification

**You MUST log the phase completion AND send the notification.**

On success (test written and fails as expected):
```bash
# Log TDD phase complete (MANDATORY)
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh phase red RED complete
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh test red FAIL "{TEST_FILE}: {FAILURE_MSG}"

# Send notification
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow red complete '{"testFile": "{TEST_FILE}", "failureMessage": "{FAILURE_MSG}"}'
```

On failure (couldn't write test):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh error red "Failed to write test: {REASON}"
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow red failed '{"reason": "{REASON}"}'
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
# Start RED phase for a feature
/oss:red user authentication

# RED phase for specific behavior
/oss:red "users can reset password via email"
```
