---
description: Emergency rollback to previous version with safety checks
---

## Help

**Command:** `/oss:rollback`

**Description:** Emergency rollback to previous version with safety checks

**Workflow Position:** incident -> **ROLLBACK** -> deploy

**Usage:**
```bash
/oss:rollback [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--to` | | Target version to rollback to (e.g., v1.2.3) |

**Examples:**
```bash
# Rollback to last known good version
/oss:rollback

# Rollback to specific version
/oss:rollback --to v1.2.3
```

**Related Commands:**
- `/oss:incident` - Incident that triggers rollback
- `/oss:monitor` - Verify recovery after rollback
- `/oss:deploy` - Re-deploy after fix
- `/oss:postmortem` - Analyze what went wrong

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

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Initialize Logging

**You MUST initialize logging for supervisor visibility.**

```bash
~/.oss/hooks/oss-log.sh init rollback
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
~/.oss/hooks/oss-notify.sh --workflow rollback start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name rollback
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

The prompt handles:
- Last known good version
- Database migration rollback (if needed)
- Service redeployment
- Health check verification

## Command Chain

```
/oss:incident    → Declare incident, assess severity
    ↓
/oss:rollback    → Emergency rollback (YOU ARE HERE)
    ↓
/oss:monitor     → Verify service restored
    │
    └── After stabilization:
        /oss:build → TDD fix development
            ↓
            /oss:ship → Ship proper fix
```

**Previous**: `/oss:incident` (critical issue declared)
**Next**: `/oss:monitor` (verify recovery)

## Example Usage

```bash
/oss:rollback
/oss:rollback --to v1.2.3
```
