---
name: ideate
description: Refine rough ideas into fully-formed designs through collaborative questioning. Use for feature design and planning.
---

# OSS Ideate

Transform vague ideas into concrete, actionable designs.

## Step 1: Ensure Project Configuration

**Check if CLAUDE.md exists in the current directory:**

```bash
test -f CLAUDE.md && echo "EXISTS" || echo "MISSING"
```

**If MISSING, fetch the full CLAUDE.md template from API and create it:**

1. Read API key from `~/.oss/config.json`
2. Fetch template from API using WebFetch:
   - Template: `${API_BASE}/api/v1/prompts/templates/claude-md` (with `Authorization: Bearer ${API_KEY}`)
   - IRON LAWS: `${API_BASE}/api/v1/prompts/shared/iron-laws` (with `Authorization: Bearer ${API_KEY}`)
3. Merge: Replace `<!-- IRON LAWS will be injected here by /oss:login -->` placeholder with fetched IRON LAWS wrapped in `<!-- IRON LAWS START -->` / `<!-- IRON LAWS END -->` markers
4. Write the fully-formed CLAUDE.md to the project root

**If API fetch fails**, fall back to a minimal CLAUDE.md that directs the user to run `/oss:login`.

## Step 2: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/ideate
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 4: Execute the Fetched Prompt

Execute the prompt returned by the API.

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
