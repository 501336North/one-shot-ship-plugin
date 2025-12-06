---
description: Configure API key for OSS Dev Workflow
---

# /oss:login - Authenticate

Configure your API key for OSS Dev Workflow access.

## API Configuration

**API Base URL:** `https://one-shot-ship-api.onrender.com`

## What This Command Does

1. **Prompts for API key** - Or accepts as argument
2. **Validates key** - Tests against API at `https://one-shot-ship-api.onrender.com/api/v1/subscription/status`
3. **Stores securely** - Saves to `~/.oss/config.json`
4. **Confirms access** - Shows subscription status

## Step 1: Get API Key

Get your API key from: https://www.oneshotship.com/dashboard

## Step 2: Configure

Enter your API key when prompted, or pass it directly:

```bash
/oss:login YOUR_API_KEY
```

## Step 3: Verification

The command will:
1. Create `~/.oss/` directory if needed
2. Store API key in `~/.oss/config.json` with format: `{"apiKey": "YOUR_KEY", "apiUrl": "https://one-shot-ship-api.onrender.com"}`
3. Verify key by calling: `curl -H "Authorization: Bearer YOUR_KEY" https://one-shot-ship-api.onrender.com/api/v1/subscription/status`
4. Display subscription status (trial, active, expired)

## Step 4: Sync CLAUDE.md (Automatic)

After successful authentication, the command automatically syncs project guidelines:

1. **Fetch template from API:**
   ```
   GET https://one-shot-ship-api.onrender.com/api/v1/prompts/claude-md
   Headers:
     Authorization: Bearer {apiKey}
   ```

2. **Check if CLAUDE.md exists in current directory:**
   ```bash
   test -f CLAUDE.md && echo "EXISTS" || echo "MISSING"
   ```

3. **If MISSING:** Create new CLAUDE.md with the fetched OSS Dev Workflow guidelines

4. **If EXISTS:**
   - Check if it contains `# OSS Dev Workflow` section
   - If no OSS section: Append the fetched content with a separator
   - If OSS section exists: Replace it with fresh version from API

**What gets synced:**
- London TDD methodology rules
- Agent delegation table (which agents to use for what)
- All available `/oss:` commands reference
- Git workflow (Agent Git Flow) guidelines
- Quality standards

**Note:** This only syncs guidelines, NOT proprietary prompts. The actual workflow logic stays on the API.

## Example Usage

```bash
# Interactive login
/oss:login

# Direct login with API key
/oss:login ak_xxxxx

# Check current status
/oss:status
```

## Config File Format

After login, `~/.oss/config.json` will contain:
```json
{
  "apiKey": "ak_xxxxx",
  "apiUrl": "https://one-shot-ship-api.onrender.com"
}
```

## Troubleshooting

### Invalid API Key
```
Get a valid key from https://www.oneshotship.com/dashboard
```

### Network Error
```
Check internet connection and try again
API endpoint: https://one-shot-ship-api.onrender.com/api/v1/subscription/status
```
