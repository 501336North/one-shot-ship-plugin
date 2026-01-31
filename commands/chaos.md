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

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```bash
~/.oss/hooks/fetch-iron-laws.sh
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 4: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow chaos start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name chaos
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

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
