---
name: rust-pro
description: Rust language expert. Use for Rust development, borrow checker issues, async/tokio patterns, and security auditing.
---

# rust-pro Agent

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found, inform the user:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

## Step 3: Fetch and Decrypt Agent Prompt

```bash
~/.oss/bin/oss-decrypt --type agents --name rust-pro
```

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
