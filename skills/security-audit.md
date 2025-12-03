---
name: security-audit
description: Security vulnerability scanning and penetration testing. Use for security reviews and audits.
---

# OSS Security Audit

Comprehensive security vulnerability scanning and analysis.

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/security-audit
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt runs:
- Dependency vulnerability scan (npm audit, Snyk)
- Static code security analysis (ESLint security plugin)
- Secret scanning (TruffleHog, GitLeaks)
- OWASP Top 10 coverage tests
- Penetration testing (auth bypass, injection, XSS, CSRF)
- Security headers check
- Environment variable audit
- Security report generation

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
/oss security-audit
```

Runs comprehensive security audit and generates report.
