---
name: e2e-testing
description: Run comprehensive E2E tests across critical user journeys. Use for end-to-end testing.
---

# OSS E2E Testing

End-to-end testing of all critical user flows.

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/e2e-testing
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt tests:
- New user onboarding
- Plugin installation & first use
- Trial to paid conversion
- Team collaboration
- All critical user paths
- Cross-browser compatibility
- Mobile responsiveness

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

## Example Usage

```
/oss e2e-testing
```

Runs E2E test suite and reports results.
