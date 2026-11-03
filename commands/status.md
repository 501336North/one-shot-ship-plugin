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

Check your One Shot Ship subscription status.

## What This Command Does

1. **Checks subscription** - Trial, Pro, Team, or Enterprise
2. **Shows trial days** - If on trial
3. **Shows usage this month** - Your command total and the most used command types

## Step 1: Fetch Status

**OSS hooks older than this plugin:** if a `~/.oss/hooks/oss-value.sh` call below prints `usage: oss-value.sh` or `No such file or directory`, the plugin was updated after this session started and `~/.oss/hooks` still holds the older copies. Do not show that output; show only this line: `Your OSS hooks are older than the plugin; restart Claude Code (or start a new session) to update them.` and stop.

Run this exactly as written (one allowed call). It sends the key from your OSS config to `/api/v1/auth/verify` on the API that config's `apiUrl` names, on curl's stdin (never on a command line or into this chat), and prints only the lines shown in Step 2 (`Account:`, `Plan:`, `Status:`, and `Trial ends:` when on trial):

```bash
~/.oss/hooks/oss-value.sh status
```

If it fails, show its message and stop: `No API key found` or `HTTP 401` means run `/oss:login` (register at https://www.oneshotship.com); `HTTP 403` means the subscription expired (upgrade at https://www.oneshotship.com/pricing).

Then run this exactly as written (one allowed call). It sends the key the same way to `/api/v1/analytics/usage` and prints this month's `Total commands:` line, then up to 10 indented `<command type>: <count>` lines, most used first (and a `(N more command types)` line when there are more). If usage cannot be fetched it prints the single line `Usage: unavailable right now`; show that line in the usage section and still show the account section:

```bash
~/.oss/hooks/oss-value.sh usage
```

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

Usage This Month
Total commands: 42 (since 2026-11-01)
  build: 20
  ship: 10
  plan: 7
  ideate: 5

==============================================
Dashboard: https://www.oneshotship.com/dashboard
==============================================
```

## Example Usage

```bash
/oss:status
```
