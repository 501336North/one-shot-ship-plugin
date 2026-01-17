---
description: Incident response protocol for production emergencies
---

## Help

**Command:** `/oss:incident`

**Description:** Incident response protocol for production emergencies

**Workflow Position:** monitor -> **INCIDENT** -> rollback

**Usage:**
```bash
/oss:incident [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--severity` | | Severity level: critical, high, medium, low |

**Examples:**
```bash
# Start incident response
/oss:incident

# Declare critical incident
/oss:incident --severity critical
```

**Related Commands:**
- `/oss:monitor` - Detection before incident
- `/oss:rollback` - Emergency rollback if needed
- `/oss:postmortem` - Post-incident analysis
- `/oss:debug` - Debug for hotfix development

---

# /oss:incident - Incident Response

Incident response protocol for production emergencies with blameless postmortem.

## What This Command Does

1. **Incident triage** - Severity assessment
2. **Communication** - Stakeholder notification
3. **Resolution tracking** - Action items
4. **Postmortem** - Blameless analysis

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
~/.oss/hooks/oss-log.sh init incident
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```bash
~/.oss/hooks/fetch-iron-laws.sh
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/incident
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt guides:
- Incident declaration
- Impact assessment
- Mitigation steps
- Communication templates
- Postmortem creation

## Command Chain

```
/oss:monitor     → Detect production issues
    ↓
/oss:incident    → Declare and respond (YOU ARE HERE)
    │
    ├── If rollback needed:
    │   /oss:rollback  → Emergency rollback
    │       ↓
    │       /oss:monitor  → Verify recovery
    │
    └── If hotfix needed:
        /oss:build → TDD hotfix
            ↓
            /oss:ship → Ship hotfix
```

**Previous**: `/oss:monitor` (issue detected)
**Next**: `/oss:rollback` (if critical) or `/oss:build` (for hotfix)

## Example Usage

```bash
/oss:incident
/oss:incident --severity critical
```
