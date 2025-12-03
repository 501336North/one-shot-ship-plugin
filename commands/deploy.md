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

## Step 2: Fetch Prompt from API

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

## Example Usage

```bash
/oss:deploy
/oss:deploy --canary 10%
```
