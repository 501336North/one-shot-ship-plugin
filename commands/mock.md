---
description: Generate type-safe mocks for collaborators (London TDD)
---

# /oss:mock - Generate Mocks

Create type-safe mocks for collaborators in London TDD.

## What This Command Does

1. **Analyzes interfaces** - Understands what to mock
2. **Generates mocks** - Type-safe implementations
3. **Adds verification** - Support for verify() calls
4. **Adds stubbing** - Support for when().thenReturn()

## Mock Types Generated

- **Stubs** - Return canned responses
- **Mocks** - Stubs + verification
- **Spies** - Real implementation + recording
- **Fakes** - Simplified working implementations

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init mock
```

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow mock start '{}'
```

## Step 4: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/mock
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 5: Execute the Fetched Prompt

The prompt guides you through:
- Identifying interfaces to mock
- Generating type-safe mocks
- Adding verification support
- Creating test fixtures

## Step 6: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

On success:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow mock complete '{"mocksCreated": {COUNT}}'
```

On failure:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow mock failed '{"reason": "{REASON}"}'
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
# Generate mock for interface
/oss:mock UserRepository

# Generate mocks for service dependencies
/oss:mock AuthService --all-deps

# Generate fake implementation
/oss:mock UserRepository --fake
```
