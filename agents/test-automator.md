---
name: test-automator
description: Create comprehensive test suites with unit, integration, and e2e tests. Sets up CI pipelines, mocking strategies, and test data. Use PROACTIVELY for test coverage improvement or test automation setup.
---

# test-automator Agent

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found, inform the user:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Agent Prompt

Use WebFetch to get the expert prompt:

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/agents/test-automator
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

Execute the prompt returned by the API. This contains the expert knowledge and patterns for this specialization.

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
