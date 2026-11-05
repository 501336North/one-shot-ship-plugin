---
description: Incident response protocol for production emergencies
---

## Help

**Command:** `/oss:incident`

**Description:** Incident response protocol for production emergencies

**Workflow Position:** monitor -> **INCIDENT** -> rollback

**Usage:**
```bash
/oss:incident [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--severity` | | Severity level: critical, high, medium, low |

**Examples:**
```bash
# Start incident response
/oss:incident

# Declare critical incident
/oss:incident --severity critical
```

**Related Commands:**
- `/oss:monitor` - Detection before incident
- `/oss:rollback` - Emergency rollback if needed
- `/oss:postmortem` - Post-incident analysis
- `/oss:debug` - Debug for hotfix development

---

# /oss:incident - Incident Response

Incident response protocol for production emergencies with blameless postmortem.

## What This Command Does

1. **Incident triage** - Severity assessment
2. **Communication** - Stakeholder notification
3. **Resolution tracking** - Action items
4. **Postmortem** - Blameless analysis

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
~/.oss/hooks/oss-log.sh init incident
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow incident start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name incident
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line what happened (rate limited, offline, or not logged in, so run /oss:login) and STOP this command; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt guides:
- Incident declaration
- Impact assessment
- Mitigation steps
- Communication templates
- Postmortem creation

## Step 7: Update Status Line (Completion)

On success only. If the command failed (the prompt sent `failed`), do not send `complete`.

**You MUST update the workflow status on completion.**

```bash
~/.oss/hooks/oss-notify.sh --workflow incident complete '{}'
```

## Command Chain

```
/oss:monitor     → Detect production issues
    ↓
/oss:incident    → Declare and respond (YOU ARE HERE)
    │
    ├── If rollback needed:
    │   /oss:rollback  → Emergency rollback
    │       ↓
    │       /oss:monitor  → Verify recovery
    │
    └── If hotfix needed:
        /oss:build → TDD hotfix
            ↓
            /oss:ship → Ship hotfix
```

**Previous**: `/oss:monitor` (issue detected)
**Next**: `/oss:rollback` (if critical) or `/oss:build` (for hotfix)

## Example Usage

```bash
/oss:incident
/oss:incident --severity critical
```
