---
name: mobile-developer
tools: "*"
description: Develop React Native or Flutter apps with native integrations. Handles offline sync, push notifications, and app store deployments. Use PROACTIVELY for mobile features, cross-platform code, or app optimization.
---

# mobile-developer Agent

## Step 1: Check Authentication

```bash
test -f "$HOME/.oss/config.json" && grep -qE '"apiKey"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]' "$HOME/.oss/config.json" && echo "API key configured"
```

If no API key found, inform the user:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch and Decrypt Agent Prompt

Ensure the decrypt CLI is installed:

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

Fetch and decrypt the prompt:

```bash
~/.oss/bin/oss-decrypt --type agents --name mobile-developer
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line and carry on with this file's own instructions; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 3: Execute the Fetched Prompt

Execute the prompt returned by the decrypt CLI. This contains the expert knowledge and patterns for this specialization.

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
