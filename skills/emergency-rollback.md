---
name: emergency-rollback
description: Emergency rollback to previous version with comprehensive safety checks and recovery. Use for production emergencies.
---

# OSS Emergency Rollback

Emergency production rollback to restore stability.

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
~/.oss/bin/oss-decrypt --type workflows --name emergency-rollback
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
