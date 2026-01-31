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

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```bash
~/.oss/hooks/fetch-iron-laws.sh
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 4: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow postmortem start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name postmortem
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

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
