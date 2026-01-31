---
description: Feature flag implementation and management
---

## Help

**Command:** `/oss:feature-flag`

**Description:** Feature flag implementation and management

**Workflow Position:** any time - **FEATURE-FLAG** management

**Usage:**
```bash
/oss:feature-flag [SUBCOMMAND] <FLAG_NAME> [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `SUBCOMMAND` | No | create, rollout, disable |
| `FLAG_NAME` | Yes | Name of the feature flag |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--percent` | | Rollout percentage (e.g., 10) |

**Examples:**
```bash
# Create a new feature flag
/oss:feature-flag create new-checkout

# Gradual rollout to 10% of users
/oss:feature-flag rollout new-checkout --percent 10

# Disable (kill switch) a feature flag
/oss:feature-flag disable new-checkout
```

**Related Commands:**
- `/oss:experiment` - A/B testing
- `/oss:deploy` - Deploy with feature flags
- `/oss:rollback` - Emergency rollback

---

# /oss:feature-flag - Feature Flags

Feature flag implementation and management.

## What This Command Does

1. **Flag creation** - Create new feature flags
2. **Rollout strategy** - Configure gradual rollouts
3. **Targeting rules** - Set up user/segment targeting
4. **Kill switch** - Emergency flag disable
5. **Cleanup** - Remove stale flags

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
~/.oss/hooks/oss-log.sh init feature-flag
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
~/.oss/hooks/oss-notify.sh --workflow feature-flag start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name feature-flag
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

The prompt handles:
- Feature flag implementation patterns
- Gradual rollout configuration
- A/B test integration
- Flag lifecycle management

## Example Usage

```bash
/oss:feature-flag create new-checkout
/oss:feature-flag rollout new-checkout --percent 10
/oss:feature-flag disable new-checkout
```
