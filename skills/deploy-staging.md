---
name: deploy-staging
description: Deploy to staging environment with safety checks and smoke tests. Use for staging deployments.
---

# OSS Deploy Staging

Safe deployment to staging environment with comprehensive checks.

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
~/.oss/bin/oss-decrypt --type workflows --name deploy-staging
```

## Step 3: Execute the Fetched Prompt

The prompt orchestrates:
- Pre-flight checks (tests, build, lint, audit, git)
- Release tagging
- Database migration (with backup)
- Application deployment to staging
- Health check verification
- Smoke tests (registration, login, auth, prompts)
- Performance check
- Team notification
- Rollback capability ready

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
/oss deploy-staging
```

Deploys to staging with comprehensive safety checks.
