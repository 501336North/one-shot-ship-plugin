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

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Initialize Logging

**You MUST initialize logging for supervisor visibility.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init stage
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/shared/iron-laws
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 3: Fetch Prompt from API

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

## Command Chain

```
/oss:ship        → Quality gates + PR + merge
    ↓
/oss:stage       → Deploy to staging (YOU ARE HERE)
    ↓
/oss:deploy      → Deploy to production
    ↓
/oss:monitor     → Watch production health
```

**Previous**: `/oss:ship` (code merged to main)
**Next**: `/oss:deploy` (production deployment) after QA approval

## Example Usage

```bash
/oss:stage
```
