---
description: Post-deployment smoke testing
---

# /oss:smoke - Smoke Tests

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init smoke
```

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/smoke
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

## Browser Smoke Testing

For web applications, run browser-based smoke tests with Playwright:

```bash
/oss:smoke --url https://staging.example.com --browser
```

**Browser smoke tests verify:**
- Critical user flows (login, main feature, checkout)
- Page load and rendering
- Key UI elements are visible
- No JavaScript console errors

**Screenshot on failure:**
If a smoke test fails, a screenshot is automatically captured for debugging:
```
smoke-failure-2026-01-13-login.png
```

## Example Usage

```bash
# API/CLI smoke tests
/oss:smoke
/oss:smoke --env production

# Browser smoke tests
/oss:smoke --url https://staging.example.com --browser
/oss:smoke --url https://prod.example.com --browser --headless
```
