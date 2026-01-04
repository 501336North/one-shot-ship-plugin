---
description: Chaos engineering and resilience testing
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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init chaos
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
