---
description: Cloud cost analysis and optimization
---

# /oss:cost - Cost Analysis

Cloud cost analysis and FinOps optimization.

## What This Command Does

1. **Cost breakdown** - Analyze spend by service
2. **Waste detection** - Find unused resources
3. **Right-sizing** - Identify over-provisioned resources
4. **Savings opportunities** - Reserved instances, spot
5. **Budget alerts** - Cost anomaly detection

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init cost
```

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/cost
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 4: Execute the Fetched Prompt

The prompt handles:
- Cloud cost analysis
- Resource optimization recommendations
- Savings calculation
- Budget monitoring setup

## Example Usage

```bash
/oss:cost
/oss:cost --provider aws
/oss:cost --period last-30-days
```
