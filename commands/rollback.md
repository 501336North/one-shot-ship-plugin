---
description: Emergency rollback to previous version with safety checks
---

# /oss:rollback - Rollback the Ship

Emergency rollback to previous version with comprehensive safety checks and recovery.

## What This Command Does

1. **Version identification** - Find stable version
2. **Safety checks** - Pre-rollback verification
3. **Rollback execution** - Revert deployment
4. **Health verification** - Post-rollback checks

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

## Step 2: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/rollback
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt handles:
- Last known good version
- Database migration rollback (if needed)
- Service redeployment
- Health check verification

## Example Usage

```bash
/oss:rollback
/oss:rollback --to v1.2.3
```
