---
name: emergency-rollback
description: Emergency rollback to previous version with comprehensive safety checks and recovery. Use for production emergencies.
---

# OSS Emergency Rollback

Emergency production rollback to restore stability.

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
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/emergency-rollback
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt orchestrates **EMERGENCY ROLLBACK**:

**Step 0: ASSESSMENT**
- Check current metrics (error rate, latency, health)
- Confirm rollback is necessary (must type "YES")

**Step 1: DECLARE EMERGENCY**
- Create rollback ID
- Identify target version
- Notify team immediately (PagerDuty + Slack)

**Step 2: CAPTURE STATE**
- Capture metrics, logs, deployment state (before rollback)

**Step 3: APPLICATION ROLLBACK**
- Rollback deployment (Kubernetes/Railway/Render)
- Verify rollback succeeded

**Step 4: DATABASE ROLLBACK (if needed)**
- Restore from backup if data corruption
- Rollback migration if schema issues

**Step 5: VERIFICATION**
- Health checks
- Error rate check
- Latency check
- Database connectivity

**Step 6: SMOKE TESTS**
- Critical functionality tests

**Step 7: MONITORING**
- Monitor for 30-60 minutes post-rollback

**Step 8: POST-ROLLBACK ANALYSIS**
- What failed? Why wasn't it caught? Prevention?

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
/oss emergency-rollback
```

**Use when production deployment fails critically.**
