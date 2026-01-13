---
description: Consumer-driven contract testing (Pact)
---

## Help

**Command:** `/oss:contract`

**Description:** Consumer-driven contract testing (Pact)

**Workflow Position:** build -> **CONTRACT** -> integration

**Usage:**
```bash
/oss:contract [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--consumer` | | Consumer service name |
| `--provider` | | Provider service name |
| `--verify` | | Verify provider against contracts |

**Examples:**
```bash
# Define contract between frontend and API
/oss:contract --consumer frontend --provider api

# Verify provider meets contracts
/oss:contract --verify
```

**Related Commands:**
- `/oss:api-design` - Design API contracts before testing
- `/oss:integration` - Validate mocked interactions work in reality
- `/oss:test` - Run comprehensive E2E tests

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

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow contract start '{}'
```

## Step 4: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/contract
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 5: Execute the Fetched Prompt

The prompt guides you through:
- Defining consumer contracts
- Generating Pact files
- Verifying provider compliance
- Handling contract failures

## Step 6: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

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
