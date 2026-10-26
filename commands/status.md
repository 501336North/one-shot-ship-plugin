---
description: Check your subscription status and usage
model: haiku
---

## Help

**Command:** `/oss:status`

**Description:** Check your subscription status and usage

**Workflow Position:** any time - **STATUS** check

**Usage:**
```bash
/oss:status [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | No arguments required |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Check subscription status
/oss:status
```

**Related Commands:**
- `/oss:login` - Authenticate with API key
- `/oss:settings` - Configure preferences
- `/oss:models` - View model configuration and costs

---

# /oss:status - Check Status

Check your One Shot Ship subscription status and usage statistics.

## What This Command Does

1. **Checks subscription** - Trial, Pro, Team, or Enterprise
2. **Shows trial days** - If on trial
3. **Displays usage** - Commands used this month
4. **Lists workflows** - Available in your plan

## Step 1: Check Configuration

```bash
~/.oss/hooks/oss-value.sh keycheck
```

If it prints nothing: "No API key found. Run: /oss:login".

## Step 2: Fetch Status

Run this one call against the API your config names; the key goes to curl on stdin, never into this conversation or a command line:

```bash
~/.oss/hooks/oss-value.sh api auth/verify
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Display Status

```
==============================================
     ONE SHOT SHIP STATUS
==============================================

Account:     user@example.com
Plan:        PRO
Status:      ACTIVE

Usage This Month: 47 commands

Available Workflows: ALL UNLIMITED

==============================================
Dashboard: https://www.oneshotship.com/dashboard
==============================================
```

## Example Usage

```bash
/oss:status
```
