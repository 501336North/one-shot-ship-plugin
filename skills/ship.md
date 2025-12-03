---
name: ship
description: Quality check, commit, create PR, and optionally merge. Use for finalizing work.
---

# OSS Ship

Complete finalization workflow - quality check, docs, commit, PR.

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
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/ship
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt orchestrates:
- Final quality checks (tests, lint, build)
- Documentation updates
- Git commit with proper message
- Pull request creation
- Optional auto-merge (with --merge flag)

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
/oss ship
/oss ship --merge
```

Finalizes work with quality gates and creates PR.
