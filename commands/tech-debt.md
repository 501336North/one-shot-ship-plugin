---
description: Identify and prioritize technical debt
---

## Help

**Command:** `/oss:tech-debt`

**Description:** Identify and prioritize technical debt

**Workflow Position:** any time - **TECH-DEBT** analysis

**Usage:**
```bash
/oss:tech-debt [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--category` | | Category: code, architecture, testing, documentation |
| `--prioritize` | | Prioritize debt by impact and effort |

**Examples:**
```bash
# Analyze all technical debt
/oss:tech-debt

# Analyze code-related debt only
/oss:tech-debt --category code

# Get prioritized debt list
/oss:tech-debt --prioritize
```

**Related Commands:**
- `/oss:review` - Code review
- `/oss:refactor` - Clean up code while keeping tests green
- `/oss:plan` - Plan debt reduction work

---

# /oss:tech-debt - Technical Debt Analysis

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
~/.oss/hooks/oss-log.sh init tech-debt
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
~/.oss/hooks/oss-notify.sh --workflow tech-debt start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name tech-debt
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

## Error Handling

### If API returns 401
```
Authentication failed. Run: /oss:login
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

```bash
/oss:tech-debt
/oss:tech-debt --category code
/oss:tech-debt --prioritize
```
