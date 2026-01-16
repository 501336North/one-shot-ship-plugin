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

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/feature-flag
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 4: Execute the Fetched Prompt

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
