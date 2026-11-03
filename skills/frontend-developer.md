---
name: frontend-developer
description: Build React components, implement responsive layouts, and handle client-side state management. Optimizes frontend performance and ensures accessibility. Use PROACTIVELY when creating UI components or fixing frontend issues.
---

# OSS Frontend Developer Agent

Expert frontend developer powered by One Shot Ship.

## Step 1: Check Authentication

```bash
grep -q '"apiKey"' "$HOME/.oss/config.json" && echo "API key configured"
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch and Decrypt Agent Prompt

Ensure the decrypt CLI is installed:

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

Fetch and decrypt the prompt:

```bash
~/.oss/bin/oss-decrypt --type agents --name frontend-developer
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line and carry on with this file's own instructions; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 3: Execute the Fetched Prompt

Execute the prompt returned by the decrypt CLI.

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
