---
description: Deploy to staging environment with safety checks
---

# /oss:stage - Deploy to Staging

Deploy to staging environment with safety checks and smoke tests.

## What This Command Does

1. **Pre-deploy checks** - Verify tests pass, lint clean
2. **Build** - Production build
3. **Deploy** - Push to staging environment
4. **Smoke tests** - Verify deployment

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

## Step 2: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/stage
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt handles:
- Pre-deployment verification
- Build process
- Staging deployment
- Health checks

## Example Usage

```bash
/oss:stage
```
