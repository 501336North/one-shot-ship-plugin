---
description: Validate that mocked interactions work in reality
---

## Help

**Command:** `/oss:integration`

**Description:** Validate that mocked interactions work with real dependencies.

**Workflow Position:** plan → acceptance → build: [ red → green → refactor ] → **INTEGRATION** → ship

**Usage:**
```bash
/oss:integration [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | - | Reviews unit test mocks and validates against real dependencies |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--boundary` | `-b` | Focus on specific boundary: database, api, filesystem |

**Examples:**
```bash
# Validate all mocked interactions
/oss:integration

# Focus on database interactions
/oss:integration --boundary database

# Show help
/oss:integration --help
```

**Related Commands:**
- `/oss:build` - Run before to complete TDD implementation
- `/oss:mock` - Generated mocks to validate
- `/oss:contract` - Consumer-driven contract testing
- `/oss:ship` - Run after integration passes

---

# /oss:integration - Integration Tests

Validate that mocked interactions work with real dependencies.

## What This Command Does

1. **Identifies mocked interactions** - Reviews unit test mocks
2. **Creates integration tests** - Tests real collaborator behavior
3. **Validates contracts** - Ensures mocks match reality
4. **Reports mismatches** - Highlights mock/reality differences

## The Integration Phase (London TDD)

After unit tests pass with mocks, integration tests verify:
- Real database operations work as mocked
- Real API calls match mock expectations
- Real file system operations succeed
- Real external services respond as expected

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init integration
```

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow integration start '{}'
```

## Step 4: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type commands --name integration
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 5: Execute the Fetched Prompt

The prompt guides you through:
- Reviewing unit test mocks
- Writing integration tests for real dependencies
- Running integration test suite
- Fixing mock/reality mismatches

## Step 6: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

On success (integration tests pass):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow integration complete '{"testsPass": {COUNT}, "boundariesTested": "{BOUNDARIES}"}'
```

On failure (integration tests fail or mock mismatch found):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow integration failed '{"reason": "{REASON}"}'
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
/oss:integration
/oss:integration --boundary database
```
