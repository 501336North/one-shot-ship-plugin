---
description: Systematic debugging workflow
---

# /oss:debug - Debug Issues

Investigate bugs and create TDD fix plans that integrate with the build workflow.

## Context Management

> **🚦 Context Gate Active**
>
> If conversation history exceeds 20 turns, this command will be **blocked**.
> You must either:
> 1. Run `/clear` first, then re-run (recommended)
> 2. Use `--force` flag to bypass: `/oss:debug --force`
>
> Why? Fresh context = CLAUDE.md (with IRON LAWS) as primary guidance = deterministic results.
> State is loaded from `.oss/dev/active/{feature}/` (project-local) or created in `.oss/dev/active/bugfix-*/`.

## What This Command Does

1. **Investigates** - Parses error/description, delegates to debugger agent
2. **Confirms** - Presents root causes, gets user confirmation
3. **Reproduces** - Writes failing test (TDD RED phase)
4. **Plans** - Creates DEBUG.md with fix tasks for /oss:build

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init debug
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/shared/iron-laws
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 4: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow debug start '{"bug": "{DESCRIPTION}"}'
```

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type commands --name debug
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt guides the debugging workflow:
- Parse bug input (error, description, or file reference)
- Delegate investigation to debugger agent
- Present root causes for user confirmation
- Write reproduction test (TDD RED phase)
- Create DEBUG.md and update PROGRESS.md

## Step 7: Update Status Line (Milestones)

**You MUST update the workflow status at key milestones.**

After root cause found:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow debug milestone '{"phase": "investigate", "causes": {COUNT}}'
```

After reproduction test written:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow debug milestone '{"phase": "reproduce", "test": "{TEST_PATH}", "status": "RED"}'
```

After debug complete:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow debug complete '{"severity": "{SEVERITY}", "tasks": {TASK_COUNT}}'
```

> Note: IRON LAW compliance checklist is automatically logged on `complete` events.

If debug fails:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow debug failed '{"reason": "{ERROR}"}'
```

## Command Chain

After debug creates the fix plan:
```
/oss:debug → /oss:build → /oss:ship
```

The fix tasks are added to PROGRESS.md and /oss:build executes them with RED-GREEN-REFACTOR discipline.

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
# With error message
/oss:debug "TypeError: Cannot read property 'id' of undefined"

# With description
/oss:debug "Login form shows wrong error message"

# Interactive mode
/oss:debug
```
