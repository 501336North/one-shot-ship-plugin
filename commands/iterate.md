---
description: Refine working features when they don't match original intent or when scope has changed
---

# /oss:iterate - Refine Features

Iterate on working features when they don't match original intent or when scope has changed.

## Context Management

> **Context Gate Active**
>
> If conversation history exceeds 20 turns, this command will be **blocked**.
> You must either:
> 1. Run `/clear` first, then re-run (recommended)
> 2. Use `--force` flag to bypass: `/oss:iterate --force`
>
> State is loaded from `.oss/dev/active/{feature}/` (project-local) or `~/.oss/dev/active/{feature}/` (fallback).

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

## Step 2: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/shared/iron-laws
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

**All IRON LAW violations must be self-corrected before proceeding.**

## Step 3: Send Start Notification

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow iterate start '{}'
```

**You MUST execute this notification command before proceeding.**

## Step 4: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/iterate
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 5: Execute the Fetched Prompt

The prompt will guide you through:
- Loading context from dev docs
- Gap discovery through questions
- Scope assessment
- Creating ITERATIONS.md with delta tasks

## Step 6: Send Completion Notifications

**You MUST execute these notification commands at the appropriate moments.**

After iteration plan is complete:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow iterate complete '{"taskCount": {N}, "trigger": "{feature_mismatch|scope_change}"}'
```

If iteration fails:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow iterate failed '{"reason": "{reason}"}'
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
