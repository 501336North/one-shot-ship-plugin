---
description: Chaos engineering and resilience testing
---

## Help

**Command:** `/oss:chaos`

**Description:** Chaos engineering and resilience testing

**Workflow Position:** deploy -> **CHAOS** (chaos engineering)

**Usage:**
```bash
/oss:chaos [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--experiment` | | Experiment type (e.g., network-partition) |
| `--target` | | Target service for chaos experiment |
| `--duration` | | Duration of experiment (e.g., 5m) |

**Examples:**
```bash
# Run chaos engineering experiment
/oss:chaos

# Network partition experiment
/oss:chaos --experiment network-partition

# Target specific service for 5 minutes
/oss:chaos --target api-service --duration 5m
```

**Related Commands:**
- `/oss:deploy` - Deploy before chaos testing
- `/oss:monitor` - Monitor during chaos experiments
- `/oss:rollback` - Emergency rollback if needed
- `/oss:incident` - Incident response for real issues

---

# /oss:chaos - Chaos Engineering

Chaos engineering and resilience testing.

## What This Command Does

1. **Hypothesis definition** - Define steady state
2. **Experiment design** - Plan chaos experiments
3. **Blast radius** - Control failure scope
4. **Execution** - Run chaos experiments
5. **Analysis** - Measure system resilience

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
~/.oss/hooks/oss-log.sh init chaos
```

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/chaos
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 4: Execute the Fetched Prompt

The prompt handles:
- Chaos experiment planning
- Failure injection patterns
- Resilience assessment
- Game day facilitation

## Example Usage

```bash
/oss:chaos
/oss:chaos --experiment network-partition
/oss:chaos --target api-service --duration 5m
```
