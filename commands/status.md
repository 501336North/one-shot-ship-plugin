---
description: Check your subscription status and usage
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
if [ -f ~/.oss/config.json ]; then
    API_KEY=$(cat ~/.oss/config.json | grep -o '"apiKey":\s*"[^"]*"' | cut -d'"' -f4)
fi
```

## Step 2: Fetch Status

```
URL: https://one-shot-ship-api.onrender.com/api/v1/auth/verify
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

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
