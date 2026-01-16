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

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/tech-debt
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

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
