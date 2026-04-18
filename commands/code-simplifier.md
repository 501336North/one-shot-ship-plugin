---
description: Simplify and refine code for clarity, consistency, and maintainability
---

## Help

**Command:** `/oss:code-simplifier`

**Description:** Simplifies and refines code for clarity, consistency, and maintainability while preserving all functionality. Focuses on recently modified code unless instructed otherwise.

**Workflow Position:** ideate → plan → build → **CODE-SIMPLIFIER** → ship

**Usage:**
```bash
/oss:code-simplifier [OPTIONS] [PATH]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `PATH` | No | Path to files or directories to simplify |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Simplify code from the current build
/oss:code-simplifier

# Simplify specific files
/oss:code-simplifier src/services/

# Show help
/oss:code-simplifier --help
```

**Related Commands:**
- `/oss:refactor` - TDD refactor phase (keeps tests green)
- `/oss:review` - Multi-perspective code review
- `/oss:build` - Build phase (auto-triggers this after TDD loop)

---

# /oss:code-simplifier - Code Simplification

Refine code for clarity without changing behavior.

## What This Command Does

1. **Simplify logic** - Remove unnecessary complexity
2. **Improve naming** - Make variables and functions self-documenting
3. **Remove duplication** - DRY up repeated patterns
4. **Apply project standards** - Match conventions from CLAUDE.md
5. **Verify tests** - Run tests after changes to ensure no regressions

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
~/.oss/hooks/oss-log.sh init code-simplifier
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow code-simplifier start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type agents --name code-simplifier
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt handles:
- Code clarity and consistency improvements
- Naming convention enforcement
- Duplication removal
- Project standards application
- Test verification after changes

## Step 7: Update Status Line (Complete)

**Completion (after simplification completes):**
```bash
~/.oss/hooks/oss-notify.sh --workflow code-simplifier complete '{}'
```

**Failure (if simplification cannot proceed):**
```bash
~/.oss/hooks/oss-notify.sh --workflow code-simplifier failed '{"reason": "{reason}"}'
```

## Example Usage

```bash
/oss:code-simplifier
/oss:code-simplifier src/services/
```
