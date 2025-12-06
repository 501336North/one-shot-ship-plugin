---
description: Load testing at scale with k6
---

# /oss:load - Load Testing

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/load
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

## Error Handling

### If API returns 401
```
Authentication failed. Run: /oss:login
```

### If API returns 403
```
Subscription expired. Upgrade at: https://www.oneshotship.com/pricing
```

### If API returns 500
```
API temporarily unavailable. Contact support@oneshotship.com
```

## Example Usage

```bash
/oss:load --vus 100 --duration 5m
/oss:load --scenario spike
```
