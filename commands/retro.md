---
description: Sprint retrospective facilitation
---

# /oss:retro - Sprint Retrospective

Sprint retrospective facilitation and action tracking.

## What This Command Does

1. **What went well** - Celebrate successes
2. **What needs improvement** - Identify pain points
3. **Action items** - Concrete improvement actions
4. **Metrics review** - Sprint velocity and quality
5. **Follow-up** - Track previous action items

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init retro
```

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/retro
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 4: Execute the Fetched Prompt

The prompt handles:
- Retrospective facilitation
- Team feedback synthesis
- Action item generation
- Progress tracking

## Example Usage

```bash
/oss:retro
/oss:retro --format mad-sad-glad
/oss:retro --sprint 42
```
