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

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Initialize Logging

**You MUST initialize logging for supervisor visibility.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init release
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

## Command Chain

```
/oss:stage       → Deploy to staging, QA testing
    ↓
/oss:deploy      → Deploy to production
    ↓
/oss:release     → Create versioned release (YOU ARE HERE)
    ↓
/oss:monitor     → Watch production health
```

**Previous**: `/oss:deploy` (production deployed)
**Next**: `/oss:monitor` (ongoing health monitoring)

## Permission Denied Fallback

If permission is denied for `npm publish` or release commands, your release is prepared:

```
⚠️ Permission denied for npm publish.

Release package prepared. To publish manually:
  npm publish
  git push --tags

Changelog generated:
  - CHANGELOG.md updated
  - Version bumped to {version}
  - Git tag created: v{version}
```

Run the commands shown above to complete the release manually.

## Example Usage

```bash
/oss:release
/oss:release --version patch
/oss:release --version minor
```
