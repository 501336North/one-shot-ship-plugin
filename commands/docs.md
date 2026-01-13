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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init docs
```

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/docs
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt handles:
- Feature branch creation
- Documentation structure setup
- Context preservation configuration

## Example Usage

```bash
/oss:docs "user-authentication"
/oss:docs "payment-integration"
```
