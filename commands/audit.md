---
description: Security vulnerability scanning and penetration testing
---

## Help

**Command:** `/oss:audit`

**Description:** Security vulnerability scanning and penetration testing

**Workflow Position:** build -> **AUDIT** (Security) -> ship

**Usage:**
```bash
/oss:audit [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--deep` | | Run deep security analysis |

**Examples:**
```bash
# Run standard security audit
/oss:audit

# Run deep security analysis
/oss:audit --deep
```

**Related Commands:**
- `/oss:review` - Code review with security focus
- `/oss:privacy` - GDPR/CCPA privacy compliance
- `/oss:license` - Open source license compliance

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

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Initialize Logging

**You MUST initialize logging for supervisor visibility.**

```bash
~/.oss/hooks/oss-log.sh init audit
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
~/.oss/hooks/oss-notify.sh --workflow audit start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name audit
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

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
