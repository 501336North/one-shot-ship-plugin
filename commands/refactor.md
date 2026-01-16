---
description: Clean up code while keeping tests green (London TDD REFACTOR phase)
---

## Help

**Command:** `/oss:refactor`

**Description:** Improve code quality while keeping all tests passing.

**Workflow Position:** plan → acceptance → build: [ red → green → **REFACTOR** ] → integration → ship

**Usage:**
```bash
/oss:refactor [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | - | Refactors the code from the current GREEN phase |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Clean up code after GREEN phase
/oss:refactor

# Show help
/oss:refactor --help
```

**Related Commands:**
- `/oss:green` - Previous step: make the test pass
- `/oss:red` - Next iteration: write next failing test
- `/oss:build` - Full TDD loop orchestrator
- `/oss:integration` - After build: validate mocks match reality

---

# /oss:refactor - Clean Up the Code

Improve code quality while keeping all tests passing.

## What This Command Does

1. **Identifies opportunities** - Finds code smells
2. **Applies refactoring** - Safely improves code
3. **Runs tests** - After every change
4. **Maintains green** - Tests stay passing

## The REFACTOR Phase (London TDD)

- Remove duplication
- Improve names and structure
- Extract methods/classes
- Run tests after EVERY change

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

**You MUST initialize logging and log the REFACTOR phase start for supervisor visibility.**

```bash
# Initialize command log
~/.oss/hooks/oss-log.sh init refactor

# Log TDD phase start (MANDATORY)
~/.oss/hooks/oss-log.sh phase refactor REFACTOR start
```

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow refactor start '{}'
```

## Step 4: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type commands --name refactor
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 5: Execute the Fetched Prompt

The prompt guides you through:
- Identifying refactoring opportunities
- Applying safe transformations
- Running tests continuously
- Improving code quality metrics

## Step 6: Log Phase Complete and Update Status Line

**You MUST log the phase completion AND update the workflow status.**

On success (refactoring complete, tests green):
```bash
# Log TDD phase complete (MANDATORY)
~/.oss/hooks/oss-log.sh phase refactor REFACTOR complete
~/.oss/hooks/oss-log.sh test refactor PASS "all tests still passing"

# Update status line
~/.oss/hooks/oss-notify.sh --workflow refactor complete '{"improvements": "{IMPROVEMENTS}"}'
```

On failure (tests broke during refactoring):
```bash
~/.oss/hooks/oss-log.sh error refactor "Tests broke during refactoring: {REASON}"
~/.oss/hooks/oss-notify.sh --workflow refactor failed '{"reason": "{REASON}"}'
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
# Refactor current working code
/oss:refactor

# Refactor specific file
/oss:refactor src/services/auth.ts

# Refactor with specific pattern
/oss:refactor --pattern "extract-method"
```
