---
name: security-audit
description: Security vulnerability scanning and penetration testing. Use for security reviews and audits.
model: opus
---

# OSS Security Audit

Comprehensive security vulnerability scanning and analysis.

## Step 1: Check Authentication

```bash
grep -q '"apiKey"' "$HOME/.oss/config.json" && echo "API key configured"
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch and Decrypt Prompt

Ensure the decrypt CLI is installed:

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

Fetch and decrypt the prompt:

```bash
~/.oss/bin/oss-decrypt --type workflows --name security-audit
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line and carry on with this file's own instructions; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

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
