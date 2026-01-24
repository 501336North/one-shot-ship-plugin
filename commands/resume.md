---
description: Continue work from a paused state
estimated_tokens: 1500-3000
---

## Help

**Command:** `/oss:resume`

**Description:** Resume work from a previous session by loading HANDOFF.md context. Automatically detects paused features or lets you choose.

**Workflow Position:** session start - **RESUME** work

**Usage:**
```bash
/oss:resume [OPTIONS] [FEATURE]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `FEATURE` | No | Feature directory name to resume (auto-detects if not provided) |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--list` | `-l` | List all resumable features |

**Examples:**
```bash
# Resume work (auto-detect or choose)
/oss:resume

# Resume specific feature
/oss:resume auth-system

# List all resumable features
/oss:resume --list

# Show help
/oss:resume --help
```

**Related Commands:**
- `/oss:pause` - Save work state (creates HANDOFF.md)
- `/oss:build` - Continue execution after resume
- `/oss:progress` - Check current progress

---

# /oss:resume - Continue Paused Work

Load handoff context and continue from where work was paused.

## What This Command Does

1. **Scans for handoffs** - Finds HANDOFF.md files in `.oss/dev/active/`
2. **Presents options** - If multiple features have handoffs
3. **Loads context** - Reads HANDOFF.md into conversation
4. **Displays state** - Shows where work stopped and next steps
5. **Routes to workflow** - Suggests appropriate next command

## Step 0: Check for --help Flag

If `--help` or `-h` is passed, display usage information and exit:

```
/oss:resume - Continue work from a paused state

USAGE:
  /oss:resume [FEATURE]    Resume specific or auto-detected feature
  /oss:resume --list       List all resumable features
  /oss:resume --help       Display this help message

ARGUMENTS:
  FEATURE    Feature directory name (optional)

OPTIONS:
  --help, -h    Show this help message
  --list, -l    List all resumable features without resuming

HANDOFF DETECTION:
  Scans .oss/dev/active/*/HANDOFF.md for paused work

WHAT HAPPENS ON RESUME:
  1. Loads HANDOFF.md context
  2. Displays current state and blockers
  3. Shows suggested next steps
  4. Routes to appropriate workflow command

EXAMPLES:
  /oss:resume                  # Auto-detect and resume
  /oss:resume auth-system      # Resume specific feature
  /oss:resume --list           # See all resumable work
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
~/.oss/hooks/oss-log.sh init resume
```

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow resume start '{}'
```

## Step 4: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name resume
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 5: Execute the Fetched Prompt

Execute the prompt returned by the API. The proprietary prompt contains:
- Scan for `.oss/dev/active/*/HANDOFF.md` files
- Present selection if multiple features found
- Load and display HANDOFF.md context
- Show current state, blockers, and next steps
- Route to appropriate workflow command

## Step 6: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

After resume is complete:
```bash
~/.oss/hooks/oss-notify.sh --workflow resume complete '{"feature": "{FEATURE_NAME}", "phase": "{PHASE}", "task": "{TASK}"}'
```

## Resume Flow

### Single Handoff Found
```
Resuming: auth-system

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 RESUME ► auth-system
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Paused at: build phase, task 4/8
Last activity: 2026-01-24 14:30

## Current State
- Created reset-password.ts stub
- Tests written, not passing yet

## Blockers
- SMTP credentials needed in .env

## Next Steps
1. Configure SMTP in .env
2. Complete email sending function
3. Run tests

▶ Continue with: /oss:build
```

### Multiple Handoffs Found
```
Multiple paused features found:

1. auth-system (build 4/8) - 2h ago
2. dashboard (plan 2/5) - 1d ago
3. api-v2 (ideate) - 3d ago

Which feature would you like to resume?
```

Use AskUserQuestion to present the choice.

### No Handoffs Found
```
No paused work found.

To start new work:
  /oss:ideate "your feature idea"

To see current progress:
  /oss:progress
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

### If specified feature not found
```
Feature 'auth-system' not found in .oss/dev/active/

Available features:
- dashboard
- api-v2

Use: /oss:resume dashboard
```

## Session Hook Integration

The resume command works with session hooks:
- `oss-session-start.sh` checks for HANDOFF.md files
- If found, prompts user about resuming
- Context from `.oss/session-context.md` is auto-injected

This enables seamless continuation even without explicit `/oss:resume`.
