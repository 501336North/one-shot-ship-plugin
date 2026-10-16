---
name: ideate
description: Refine rough ideas into fully-formed designs through collaborative questioning. Use for feature design and planning.
model: opus
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
3. Write the template to `CLAUDE.md` in the project root with the `<!-- IRON LAWS will be injected here by /oss:login -->` placeholder line removed. Do not write any IRON LAWS markers or IRON LAWS content yourself.
4. Install the IRON LAWS block through the single writer: `~/.oss/hooks/oss-iron-laws-sync.sh --install`. If it exits non-zero, keep the template as written and tell the user to run `/oss:login`.

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
