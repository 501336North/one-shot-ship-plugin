---
description: Save current work state for later resumption
estimated_tokens: 1500-3000
---

## Help

**Command:** `/oss:pause`

**Description:** Create a handoff document capturing current work state for later resumption. Use when stopping mid-task or ending a session.

**Workflow Position:** any time - **PAUSE** session

**Usage:**
```bash
/oss:pause [OPTIONS]
```

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--feature` | `-f` | Specify feature to pause (auto-detects if not provided) |
| `--no-commit` | | Don't commit the handoff document |

**Examples:**
```bash
# Pause current work
/oss:pause

# Pause specific feature
/oss:pause --feature auth-system

# Pause without committing
/oss:pause --no-commit

# Show help
/oss:pause --help
```

**Related Commands:**
- `/oss:resume` - Continue from paused state
- `/oss:build` - Execute implementation (may pause mid-way)
- `/oss:quick` - Quick tasks (may pause mid-way)

---

# /oss:pause - Save Work State

Create a handoff document for session continuation.

## What This Command Does

1. **Detects active work** - Finds current feature from `.oss/dev/active/`
2. **Captures current state** - Phase, task, progress, blockers
3. **Creates HANDOFF.md** - Structured document for resumption
4. **Saves session context** - For automatic injection on resume
5. **Optionally commits** - Preserves state in git

## Step 0: Check for --help Flag

If `--help` or `-h` is passed, display usage information and exit:

```
/oss:pause - Save current work state for later resumption

USAGE:
  /oss:pause              Pause current work
  /oss:pause --help       Display this help message

OPTIONS:
  --help, -h       Show this help message
  --feature, -f    Specify feature to pause
  --no-commit      Don't commit the handoff document

OUTPUT:
  .oss/dev/active/{feature}/HANDOFF.md

HANDOFF CONTENTS:
  - Current phase and task
  - Work completed so far
  - Blockers encountered
  - Suggested next steps
  - Context for resumption

RESUMPTION:
  Run /oss:resume to continue from where you left off

EXAMPLES:
  /oss:pause                     # Pause current work
  /oss:pause -f auth-system      # Pause specific feature
  /oss:pause --no-commit         # Pause without committing
```

**If --help is detected, output the above and do not proceed.**

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
~/.oss/hooks/oss-log.sh init pause
```

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow pause start '{"feature": "{FEATURE_NAME}"}'
```

## Step 4: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name pause
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 5: Execute the Fetched Prompt

Execute the prompt returned by the API. The proprietary prompt contains:
- Active feature detection from `.oss/dev/active/`
- Current state extraction from PROGRESS.md
- HANDOFF.md creation with structured content
- Session context save to `.oss/session-context.md`
- Optional git commit of handoff document

## Step 6: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

After pause is complete:
```bash
~/.oss/hooks/oss-notify.sh --workflow pause complete '{"feature": "{FEATURE_NAME}", "handoffPath": "{PATH}"}'
```

## HANDOFF.md Format

The command creates `HANDOFF.md` in the feature directory:

```markdown
# Handoff: {Feature Name}

## Paused At
- **Phase:** build
- **Task:** 4/8 - Implement password reset
- **Time:** 2026-01-24 14:30 UTC

## Work Completed
- [x] User registration endpoint
- [x] Login endpoint
- [x] JWT token generation
- [ ] Password reset (in progress)

## Current State
- Created `reset-password.ts` stub
- Tests written, not passing yet
- Waiting for email service integration

## Blockers
- SMTP credentials needed in .env

## Suggested Next Steps
1. Configure SMTP in .env
2. Complete email sending function
3. Run tests: `npm test -- password-reset`

## Context for Resumption
- Using bcrypt for password hashing
- JWT tokens expire in 15 minutes
- Reset tokens valid for 1 hour
```

## Error Handling

### If no active feature found
```
No active feature found in .oss/dev/active/

To pause, you must have an active feature. Start one with:
  /oss:ideate "your feature idea"
  /oss:plan
```

### If API returns 401
```
Authentication failed. Run: /oss:login
```

### If API returns 403
```
Subscription expired. Upgrade at: https://www.oneshotship.com/pricing
```

## Session Hook Integration

The pause command also:
- Saves context to `.oss/session-context.md` for hook injection
- This context is automatically injected on next session start
- Enables seamless continuation even without explicit `/oss:resume`
