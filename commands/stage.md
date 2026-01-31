---
description: Deploy to staging environment with safety checks
---

## Help

**Command:** `/oss:stage`

**Description:** Deploy to staging environment with safety checks

**Workflow Position:** ship -> **STAGE** -> smoke -> deploy

**Usage:**
```bash
/oss:stage [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Deploy to staging environment
/oss:stage
```

**Related Commands:**
- `/oss:ship` - Quality check and PR before staging
- `/oss:smoke` - Run smoke tests after staging
- `/oss:deploy` - Deploy to production after staging approval
- `/oss:load` - Run load tests on staging

---

# /oss:stage - Deploy to Staging

Deploy to staging environment with safety checks and smoke tests.

## What This Command Does

1. **Pre-deploy checks** - Verify tests pass, lint clean
2. **Build** - Production build
3. **Deploy** - Push to staging environment
4. **Smoke tests** - Verify deployment

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
~/.oss/hooks/oss-log.sh init stage
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
~/.oss/hooks/oss-notify.sh --workflow stage start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name stage
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

The prompt handles:
- Pre-deployment verification
- Build process
- Staging deployment
- Health checks

## Command Chain

```
/oss:ship        → Quality gates + PR + merge
    ↓
/oss:stage       → Deploy to staging (YOU ARE HERE)
    ↓
/oss:deploy      → Deploy to production
    ↓
/oss:monitor     → Watch production health
```

**Previous**: `/oss:ship` (code merged to main)
**Next**: `/oss:deploy` (production deployment) after QA approval

## Example Usage

```bash
/oss:stage
```
