---
description: Open source license compliance audit
---

## Help

**Command:** `/oss:license`

**Description:** Open source license compliance audit

**Workflow Position:** any time - **LICENSE** compliance

**Usage:**
```bash
/oss:license [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--output` | | Output file for attribution (e.g., NOTICE.md) |
| `--policy` | | Policy level: strict, standard, permissive |

**Examples:**
```bash
# Run license audit
/oss:license

# Output attribution file
/oss:license --output NOTICE.md

# Strict policy checking
/oss:license --policy strict
```

**Related Commands:**
- `/oss:audit` - Security audit
- `/oss:privacy` - Privacy compliance
- `/oss:review` - Code review

---

# /oss:license - License Audit

Open source license compliance audit.

## What This Command Does

1. **Dependency scan** - Scan all dependencies for licenses
2. **Compatibility check** - Verify license compatibility
3. **Attribution** - Generate attribution notices
4. **Risk assessment** - Identify copyleft/proprietary risks
5. **Policy compliance** - Check against org policies

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
~/.oss/hooks/oss-log.sh init license
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
~/.oss/hooks/oss-notify.sh --workflow license start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name license
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

The prompt handles:
- License detection and classification
- Compatibility matrix analysis
- Attribution file generation
- Risk report creation

## Example Usage

```bash
/oss:license
/oss:license --output NOTICE.md
/oss:license --policy strict
```
