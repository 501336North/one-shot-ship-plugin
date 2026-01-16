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

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/experiment
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 4: Execute the Fetched Prompt

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
