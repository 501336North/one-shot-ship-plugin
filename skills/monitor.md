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

Install the decrypt CLI if it is missing (a fresh install has none yet):

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

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
