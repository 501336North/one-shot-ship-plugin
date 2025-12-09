---
description: Deploy to production with canary rollout and monitoring
---

# /oss:deploy - Deploy to Production

Deploy to production with canary rollout and comprehensive monitoring.

## What This Command Does

1. **Pre-production checks** - Verify staging is stable
2. **Canary deploy** - Gradual rollout
3. **Monitoring** - Watch for errors
4. **Full rollout** - Complete deployment

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init deploy
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

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/deploy
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt handles:
- Staging verification
- Canary deployment
- Error monitoring
- Progressive rollout

## Command Chain

```
/oss:stage       → Deploy to staging, QA testing
    ↓
/oss:deploy      → Deploy to production (YOU ARE HERE)
    ↓
/oss:release     → Create versioned release (optional)
    ↓
/oss:monitor     → Watch production health
    │
    └── If issues:
        /oss:rollback → Emergency rollback
```

**Previous**: `/oss:stage` (staging validated)
**Next**: `/oss:monitor` (watch production health)

## Example Usage

```bash
/oss:deploy
/oss:deploy --canary 10%
```
