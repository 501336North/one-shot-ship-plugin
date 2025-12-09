---
description: Consumer-driven contract testing (Pact)
---

# /oss:contract - Contract Testing

Consumer-driven contract testing to ensure service compatibility.

## What This Command Does

1. **Defines contracts** - Consumer expectations of provider
2. **Generates Pact files** - Machine-readable contracts
3. **Verifies provider** - Provider satisfies consumer contracts
4. **Reports breaking changes** - Identifies incompatibilities

## Contract Testing in London TDD

Contract tests sit between unit and integration tests:
- Consumer defines expected provider behavior
- Provider verifies it meets all consumer contracts
- Breaking changes caught before deployment
- Enables independent service deployment

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init contract
```

## Step 3: Send Start Notification

**You MUST execute this notification command before proceeding.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow contract start '{}'
```

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/contract
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 4: Execute the Fetched Prompt

The prompt guides you through:
- Defining consumer contracts
- Generating Pact files
- Verifying provider compliance
- Handling contract failures

## Step 5: Send Completion Notification

**You MUST execute the appropriate notification command.**

On success (contracts verified):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow contract complete '{"contractsVerified": {COUNT}, "consumers": "{CONSUMERS}"}'
```

On failure (contract verification failed):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow contract failed '{"reason": "{REASON}"}'
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
/oss:contract --consumer frontend --provider api
/oss:contract --verify
```
