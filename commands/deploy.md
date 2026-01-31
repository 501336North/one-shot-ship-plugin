---
description: Deploy to production with canary rollout and monitoring
---

## Help

**Command:** `/oss:deploy`

**Description:** Deploy to production with canary rollout and monitoring

**Workflow Position:** stage -> smoke -> **DEPLOY** -> monitor

**Usage:**
```bash
/oss:deploy [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--canary` | | Canary rollout percentage (e.g., 10%) |

**Examples:**
```bash
# Deploy to production
/oss:deploy

# Deploy with 10% canary rollout
/oss:deploy --canary 10%
```

**Related Commands:**
- `/oss:stage` - Deploy to staging first
- `/oss:smoke` - Run smoke tests before deploy
- `/oss:monitor` - Watch production health after deploy
- `/oss:rollback` - Emergency rollback if issues

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
~/.oss/hooks/oss-log.sh init deploy
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```bash
~/.oss/hooks/fetch-iron-laws.sh
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 4: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow deploy start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name deploy
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

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

## Permission Denied Fallback

If permission is denied for `kubectl` or deployment commands, your manifests are preserved:

```
⚠️ Permission denied for kubectl apply.

Deployment manifests prepared. To deploy manually:
  kubectl apply -f {manifest-path}
  kubectl rollout status deployment/{name}

Files created:
  - deployment.yaml
  - service.yaml
```

Run the commands shown above to complete the deployment manually.

## Example Usage

```bash
/oss:deploy
/oss:deploy --canary 10%
```
