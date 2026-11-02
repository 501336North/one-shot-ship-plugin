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

## Step 1: Fetch Status

Run this exactly as written (one allowed call). It sends the key from your OSS config to `/api/v1/auth/verify` on the API that config's `apiUrl` names, on curl's stdin (never on a command line or into this chat), and prints only the lines shown in Step 2 (`Account:`, `Plan:`, `Status:`, and `Trial ends:` when on trial):

```bash
~/.oss/hooks/oss-value.sh status
```

If it fails, show its message and stop: `No API key found` or `HTTP 401` means run `/oss:login` (register at https://www.oneshotship.com); `HTTP 403` means the subscription expired (upgrade at https://www.oneshotship.com/pricing).

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 2: Display Status

```
==============================================
     ONE SHOT SHIP STATUS
==============================================

Account:     user@example.com
Plan:        PRO
Status:      ACTIVE
Trial ends:  2026-12-01   (only when the output has a Trial ends: line)

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
