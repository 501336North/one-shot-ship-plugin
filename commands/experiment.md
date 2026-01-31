---
description: A/B testing and experimentation framework
---

## Help

**Command:** `/oss:experiment`

**Description:** A/B testing and experimentation framework

**Workflow Position:** any time - **EXPERIMENT** (A/B testing)

**Usage:**
```bash
/oss:experiment [SUBCOMMAND] <EXPERIMENT_NAME>
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `SUBCOMMAND` | No | create, analyze, report |
| `EXPERIMENT_NAME` | Yes | Name of the experiment |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Create a new experiment
/oss:experiment create checkout-flow

# Analyze experiment results
/oss:experiment analyze checkout-flow

# Generate experiment report
/oss:experiment report checkout-flow
```

**Related Commands:**
- `/oss:feature-flag` - Feature flag management
- `/oss:monitor` - Monitor experiment metrics
- `/oss:deploy` - Deploy experiment variants

---

# /oss:experiment - A/B Testing

A/B testing and experimentation framework.

## What This Command Does

1. **Experiment design** - Statistical experiment setup
2. **Variant creation** - Control and treatment variants
3. **Metrics definition** - Success metrics configuration
4. **Analysis** - Statistical significance testing
5. **Results reporting** - Experiment outcome reports

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
~/.oss/hooks/oss-log.sh init experiment
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
~/.oss/hooks/oss-notify.sh --workflow experiment start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name experiment
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

The prompt handles:
- Experiment hypothesis definition
- Sample size calculation
- Variant implementation
- Statistical analysis

## Example Usage

```bash
/oss:experiment create checkout-flow
/oss:experiment analyze checkout-flow
/oss:experiment report checkout-flow
```
