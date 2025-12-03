---
description: Create a versioned release with changelog
---

# /oss:release - Create Release

Create a versioned release with automated changelog generation.

## What This Command Does

1. **Version bump** - Semantic versioning
2. **Changelog** - Generate from commits
3. **Tag** - Create git tag
4. **Publish** - Push release

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

## Step 2: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/release
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt handles:
- Version determination (major/minor/patch)
- Changelog generation
- Git tagging
- Release publishing

## Example Usage

```bash
/oss:release
/oss:release --version patch
/oss:release --version minor
```
