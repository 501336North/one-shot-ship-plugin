---
name: rust-pro
description: Rust language expert with deep borrow checker, async/tokio, and security auditing expertise. Generates borrow-checker-clean code, explains ownership concepts, audits unsafe blocks, and integrates with London TDD workflow. Use PROACTIVELY for Rust development, compiler errors, async patterns, or security review.
---

# rust-pro Agent

## Step 1: Check Authentication

```bash
grep -q '"apiKey"' "$HOME/.oss/config.json" && echo "API key configured"
```

If no API key found, inform the user:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

## Step 3: Fetch and Decrypt Agent Prompt

```bash
~/.oss/bin/oss-decrypt --type agents --name rust-pro
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line and carry on with this file's own instructions; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 4: Execute the Fetched Prompt

Execute the prompt returned by the decrypt CLI. This contains the expert knowledge and patterns for Rust specialization.

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
