---
description: Create development documentation structure for a feature
---

## Help

**Command:** `/oss:docs`

**Description:** Create development documentation structure for a feature

**Workflow Position:** any time - **DOCS** generation

**Usage:**
```bash
/oss:docs [OPTIONS] <FEATURE_NAME>
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `FEATURE_NAME` | Yes | Name of the feature for documentation |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Create docs for user authentication feature
/oss:docs "user-authentication"

# Create docs for payment integration
/oss:docs "payment-integration"
```

**Related Commands:**
- `/oss:plan` - Create TDD implementation plan
- `/oss:ideate` - Transform ideas into designs
- `/oss:adr` - Create Architecture Decision Records

---

# /oss:docs - Create Dev Docs

Create a development documentation structure for feature branch + context preservation.

## What This Command Does

1. **Creates feature branch** - Creates isolated branch for development
2. **Sets up dev docs** - Creates documentation structure in `dev/active/`
3. **Preserves context** - Enables context recovery across compactions

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
~/.oss/hooks/oss-log.sh init docs
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
~/.oss/hooks/oss-notify.sh --workflow docs start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name docs
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

The prompt handles:
- Feature branch creation
- Documentation structure setup
- Context preservation configuration

## Example Usage

```bash
/oss:docs "user-authentication"
/oss:docs "payment-integration"
```
