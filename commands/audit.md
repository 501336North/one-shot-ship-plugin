---
description: Security vulnerability scanning and penetration testing
---

# /oss:audit - Security Audit

Security vulnerability scanning and penetration testing.

## What This Command Does

1. **Dependency scan** - Check for vulnerable packages
2. **Code analysis** - Static security analysis
3. **OWASP checks** - Top 10 vulnerability scan
4. **Report generation** - Security findings report

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

## Step 2: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/audit
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt handles:
- npm audit / yarn audit
- SAST scanning
- Secret detection
- Security report generation

## Example Usage

```bash
/oss:audit
/oss:audit --deep
```
