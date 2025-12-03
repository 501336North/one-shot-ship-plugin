---
name: monitor
description: Monitor production health, metrics, and identify issues
---

# OSS Monitor

Real-time production health monitoring and alerting.

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

## Step 2: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/monitor
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt monitors:
- System health (uptime, errors, latency)
- Infrastructure (CPU, memory, disk)
- Business metrics (users, API calls)
- Alerts and incidents

## Example Usage

```
/oss monitor
```

Displays real-time dashboard and alerts on issues.
