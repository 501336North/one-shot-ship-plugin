---
description: GDPR/CCPA privacy compliance audit
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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init privacy
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
