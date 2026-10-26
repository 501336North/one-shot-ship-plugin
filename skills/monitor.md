---
name: monitor
description: Monitor production health, metrics, and identify issues
---

# OSS Monitor

Real-time production health monitoring and alerting.

## Step 1: Check Authentication

```bash
~/.oss/hooks/oss-value.sh keycheck
```

## Step 2: Fetch Prompt from API

```bash
~/.oss/bin/oss-decrypt --type workflows --name monitor
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
