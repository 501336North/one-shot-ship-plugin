---
description: Sprint retrospective facilitation
---

## Help

**Command:** `/oss:retro`

**Description:** Sprint retrospective facilitation

**Workflow Position:** any time - **RETRO** (sprint retrospective)

**Usage:**
```bash
/oss:retro [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--format` | | Retro format (mad-sad-glad, start-stop-continue) |
| `--sprint` | | Sprint number to retrospect |

**Examples:**
```bash
# Start retrospective
/oss:retro

# Use mad-sad-glad format
/oss:retro --format mad-sad-glad

# Retrospect specific sprint
/oss:retro --sprint 42
```

**Related Commands:**
- `/oss:postmortem` - Incident postmortem
- `/oss:plan` - Plan next sprint
- `/oss:tech-debt` - Technical debt analysis

---

# /oss:retro - Sprint Retrospective

Sprint retrospective facilitation and action tracking.

## What This Command Does

1. **What went well** - Celebrate successes
2. **What needs improvement** - Identify pain points
3. **Action items** - Concrete improvement actions
4. **Metrics review** - Sprint velocity and quality
5. **Follow-up** - Track previous action items

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
~/.oss/hooks/oss-log.sh init retro
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```bash
~/.oss/hooks/fetch-iron-laws.sh
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 4: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow retro start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name retro
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

The prompt handles:
- Retrospective facilitation
- Team feedback synthesis
- Action item generation
- Progress tracking

## Example Usage

```bash
/oss:retro
/oss:retro --format mad-sad-glad
/oss:retro --sprint 42
```
