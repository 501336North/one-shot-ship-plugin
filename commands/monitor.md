---
description: Monitor production health with real-time metrics and alerting
---

# /oss:monitor - Watch the Lighthouse

Monitor production health with real-time metrics, error tracking, and alerting.

## What This Command Does

1. **Health checks** - Service availability
2. **Metrics review** - Key performance indicators
3. **Error tracking** - Recent errors and trends
4. **Alert status** - Active alerts and incidents

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
- Uptime and availability
- Response times (p50, p95, p99)
- Error rates
- Resource utilization

## Example Usage

```bash
/oss:monitor
/oss:monitor --detailed
```
