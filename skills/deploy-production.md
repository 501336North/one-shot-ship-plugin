---
name: deploy-production
description: Deploy to production with canary rollout and comprehensive monitoring. Use for production deployments.
---

# OSS Deploy Production

Production deployment with zero downtime and comprehensive safety checks.

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/deploy-production
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt orchestrates **EXTREMELY CAREFUL** production deployment:
- EXPLICIT confirmation required (must type "DEPLOY TO PRODUCTION")
- Final safety checks (staging stable, no incidents, all tests pass)
- Rollback preparation
- Database migration (with backup)
- Canary deployment (10% traffic)
- Monitor canary (15 minutes)
- Gradual rollout (25% → 50% → 75% → 100%)
- Remove old version
- Post-deployment verification
- Monitor for 1 hour
- Stakeholder notification

## Error Handling

### If API returns 401
```
Authentication failed. Run: /oss login
```

### If API returns 403
```
Subscription expired. Upgrade at: https://www.oneshotship.com/pricing
```

### If API returns 500
```
API temporarily unavailable. Contact support@oneshotship.com
```

## Example Usage

```
/oss deploy-production
```

**WARNING: Requires explicit confirmation. Affects real users.**
