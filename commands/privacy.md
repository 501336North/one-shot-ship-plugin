---
description: GDPR/CCPA privacy compliance audit
---

## Help

**Command:** `/oss:privacy`

**Description:** GDPR/CCPA privacy compliance audit

**Workflow Position:** any time - **PRIVACY** (GDPR/CCPA)

**Usage:**
```bash
/oss:privacy [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--regulation` | | Regulation to check (GDPR, CCPA) |
| `--deep` | | Run deep analysis |

**Examples:**
```bash
# Run privacy audit
/oss:privacy

# GDPR specific audit
/oss:privacy --regulation GDPR

# Deep privacy analysis
/oss:privacy --deep
```

**Related Commands:**
- `/oss:audit` - Security audit
- `/oss:license` - License compliance
- `/oss:review` - Code review

---

# /oss:privacy - Privacy Audit

GDPR and CCPA privacy compliance audit.

## What This Command Does

1. **PII detection** - Find personally identifiable information
2. **Data flow analysis** - Track how data moves through system
3. **Consent verification** - Check consent mechanisms
4. **Retention policies** - Verify data retention compliance
5. **Third-party audit** - Check external data sharing

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
~/.oss/hooks/oss-log.sh init privacy
```

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/privacy
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 4: Execute the Fetched Prompt

The prompt handles:
- GDPR Article 5 principles check
- CCPA consumer rights verification
- Data mapping and inventory
- Privacy impact assessment

## Example Usage

```bash
/oss:privacy
/oss:privacy --regulation GDPR
/oss:privacy --deep
```
