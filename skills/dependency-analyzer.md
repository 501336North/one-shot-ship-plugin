---
name: dependency-analyzer
description: Analyzes project dependencies, identifies conflicts, and manages dependency updates for optimal project health.
---

# OSS Dependency Analyzer Agent

Expert dependency analyzer powered by One Shot Ship.

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Agent Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/agents/dependency-analyzer
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The API returns the expert prompt which you execute directly.

## Error Handling

### If API returns 401
```
Authentication failed. Run: /oss login
```

### If API returns 403
```
Subscription expired. Upgrade at: https://www.oneshotship.com/pricing
```

### If API returns 500
```
API temporarily unavailable. Contact support@oneshotship.com
```
