---
description: Refine working features when they don't match original intent or when scope has changed
---

## Help

**Command:** `/oss:iterate`

**Description:** Refine working features when they don't match original intent or when scope has changed

**Workflow Position:** build -> ship -> **ITERATE** (refinement loop)

**Usage:**
```bash
/oss:iterate [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | Loads context from feature's dev docs |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Iterate on current feature (loads context from dev docs)
/oss:iterate
```

**Related Commands:**
- `/oss:build` - Execute tasks from iteration plan
- `/oss:debug` - For bugs/errors (not feature mismatches)
- `/oss:ideate` - For starting fresh with new ideas
- `/oss:plan` - For creating new implementation plans

---

# /oss:iterate - Refine Features

Iterate on working features when they don't match original intent or when scope has changed.

## What This Command Does

1. **Loads context** - Reads DESIGN.md, PLAN.md, PROGRESS.md from the feature directory
2. **Discovers gaps** - Asks clarifying questions to understand the mismatch
3. **Assesses scope** - Determines if changes are small (iterate) or large (ideate)
4. **Produces delta tasks** - Creates ITERATIONS.md with TDD tasks for `/oss:build`

## When to Use

**Use iterate when:**
- Feature works but doesn't do what you wanted (feature mismatch)
- Scope has changed since the original plan (scope change)

**Do NOT use iterate for:**
- Bugs or errors - use `/oss:debug` instead
- Starting fresh - use `/oss:ideate` instead

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
~/.oss/hooks/oss-log.sh init iterate
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```bash
~/.oss/hooks/fetch-iron-laws.sh
```

**All IRON LAW violations must be self-corrected before proceeding.**

## Step 4: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow iterate start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name iterate
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

The prompt will guide you through:
- Loading context from dev docs
- Gap discovery through questions
- Scope assessment
- Creating ITERATIONS.md with delta tasks

## Step 8: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

After iteration plan is complete:
```bash
~/.oss/hooks/oss-notify.sh --workflow iterate complete '{"taskCount": {N}, "trigger": "{feature_mismatch|scope_change}"}'
```

If iteration fails:
```bash
~/.oss/hooks/oss-notify.sh --workflow iterate failed '{"reason": "{reason}"}'
```

## Command Chain

This command fits in the iteration workflow:

```
/oss:build (original) → [feature works but not right] → /oss:iterate → /oss:build (delta tasks)
```

After iterate completes:
- `/oss:build` - Execute the delta tasks from ITERATIONS.md

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
