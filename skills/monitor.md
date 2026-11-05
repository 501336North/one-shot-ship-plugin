---
name: monitor
description: Monitor production health, metrics, and identify issues
---

# OSS Monitor

Real-time production health monitoring and alerting.

## Step 1: Check Authentication

```bash
test -f "$HOME/.oss/config.json" && grep -qE '"apiKey"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]' "$HOME/.oss/config.json" && echo "API key configured"
```

## Step 2: Fetch and Decrypt Prompt

Ensure the decrypt CLI is installed:

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

Fetch and decrypt the prompt:

```bash
~/.oss/bin/oss-decrypt --type workflows --name monitor
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line and carry on with this file's own instructions; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 3: Execute the Fetched Prompt

The prompt monitors:
- System health (uptime, errors, latency)
- Infrastructure (CPU, memory, disk)
- Business metrics (users, API calls)
- Alerts and incidents

## Example Usage

```
/oss monitor
```

Displays real-time dashboard and alerts on issues.
