---
description: Create development documentation structure for a feature
---

# /oss:docs - Create Dev Docs

Create a development documentation structure for feature branch + context preservation.

## What This Command Does

1. **Creates feature branch** - Creates isolated branch for development
2. **Sets up dev docs** - Creates documentation structure in `dev/active/`
3. **Preserves context** - Enables context recovery across compactions

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

## Step 2: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/docs
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt handles:
- Feature branch creation
- Documentation structure setup
- Context preservation configuration

## Example Usage

```bash
/oss:docs "user-authentication"
/oss:docs "payment-integration"
```
