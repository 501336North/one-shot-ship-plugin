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
~/.oss/hooks/oss-log.sh init iterate
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow iterate start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name iterate
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line what happened (rate limited, offline, or not logged in, so run /oss:login) and STOP this command; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt will guide you through:
- Loading context from dev docs
- Gap discovery through questions
- Scope assessment
- Creating ITERATIONS.md with delta tasks

## Step 7: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

After iteration plan is complete:
```bash
~/.oss/hooks/oss-notify.sh --workflow iterate complete '{}'
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
