---
description: Write minimal code to pass tests (London TDD GREEN phase)
---

## Help

**Command:** `/oss:green`

**Description:** Write the minimal implementation to make failing tests pass.

**Workflow Position:** plan → acceptance → build: [ red → **GREEN** → refactor ] → integration → ship

**Usage:**
```bash
/oss:green [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | - | Uses the failing test from the RED phase |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Make the current failing test pass
/oss:green

# Show help
/oss:green --help
```

**Related Commands:**
- `/oss:red` - Previous step: write the failing test
- `/oss:refactor` - Next step: clean up the code
- `/oss:build` - Full TDD loop orchestrator

---

# /oss:green - Make the Test Pass

Write the minimal implementation to make failing tests pass.

## What This Command Does

1. **Analyzes failing test** - Understands what's needed
2. **Extracts mock expectations** - What behavior is expected
3. **Writes minimal code** - Just enough to pass
4. **Verifies success** - Confirms test passes

## The GREEN Phase (London TDD)

- Only enough code to satisfy the test
- No extra features
- No "while I'm here" changes
- Implementation satisfies mock expectations

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

**You MUST initialize logging and log the GREEN phase start for supervisor visibility.**

```bash
# Initialize command log
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init green

# Log TDD phase start (MANDATORY)
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh phase green GREEN start
```

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow green start '{}'
```

## Step 4: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type commands --name green
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 5: Execute the Fetched Prompt

The prompt guides you through:
- Analyzing the failing test
- Understanding mock expectations
- Writing minimal implementation
- Running tests to confirm GREEN

## Step 6: Log Phase Complete and Update Status Line

**You MUST log the phase completion AND update the workflow status.**

On success (test passes):
```bash
# Log TDD phase complete (MANDATORY)
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh phase green GREEN complete
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh test green PASS "{TEST_FILE}"

# Update status line
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow green complete '{"testFile": "{TEST_FILE}", "linesAdded": {LINES}}'
```

On failure (couldn't make test pass):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh error green "Failed to pass test: {REASON}"
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow green failed '{"reason": "{REASON}"}'
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
# Make the current failing test pass
/oss:green

# GREEN phase for specific test file
/oss:green src/auth/login.test.ts
```
