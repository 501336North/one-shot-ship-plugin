---
name: deploy-production
description: Deploy to production with canary rollout and comprehensive monitoring. Use for production deployments.
---

# OSS Deploy Production

Production deployment with zero downtime and comprehensive safety checks.

## Step 1: Check Authentication

```bash
~/.oss/hooks/oss-value.sh keycheck
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Prompt from API

Install the decrypt CLI if it is missing (a fresh install has none yet):

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

```bash
~/.oss/bin/oss-decrypt --type workflows --name deploy-production
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
