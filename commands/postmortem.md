---
description: Incident postmortem analysis and documentation
---

## Help

**Command:** `/oss:postmortem`

**Description:** Incident postmortem analysis and documentation

**Workflow Position:** incident -> resolution -> **POSTMORTEM**

**Usage:**
```bash
/oss:postmortem [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--incident` | | Incident ID to analyze (e.g., INC-2024-001) |
| `--template` | | Template to use (e.g., google-sre) |

**Examples:**
```bash
# Start postmortem for recent incident
/oss:postmortem

# Postmortem for specific incident
/oss:postmortem --incident INC-2024-001

# Use Google SRE template
/oss:postmortem --template google-sre
```

**Related Commands:**
- `/oss:incident` - Incident response before postmortem
- `/oss:adr` - Document decisions from postmortem
- `/oss:retro` - Sprint retrospective

---

# /oss:postmortem - Incident Postmortem

Incident postmortem analysis and blameless documentation.

## What This Command Does

1. **Timeline construction** - Build incident timeline
2. **Root cause analysis** - 5 Whys methodology
3. **Impact assessment** - User and business impact
4. **Action items** - Preventive measures
5. **Documentation** - Postmortem report generation

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
~/.oss/hooks/oss-log.sh init postmortem
```

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/postmortem
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 4: Execute the Fetched Prompt

The prompt handles:
- Blameless postmortem facilitation
- Root cause identification
- Contributing factor analysis
- Action item prioritization

## Example Usage

```bash
/oss:postmortem
/oss:postmortem --incident INC-2024-001
/oss:postmortem --template google-sre
```
