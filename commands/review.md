---
description: Multi-perspective code review (correctness, security, performance, maintainability)
estimated_tokens: 3000-10000
---

# /oss:review - Code Review

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init review
```

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow review start '{}'
```

## Step 4: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type commands --name review
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 5: Execute the Fetched Prompt

Execute the code review prompt.

## Step 6: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

On success:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow review complete '{}'
```

On failure:
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow review failed '{"error": "{ERROR_MESSAGE}"}'
```

## Error Handling

### If API returns 401
```
Authentication failed. Run: /oss:login
```

### If API returns 403
```
Subscription expired. Upgrade at: https://www.oneshotship.com/pricing
```

### If API returns 500
```
API temporarily unavailable. Contact support@oneshotship.com
```

## Example Usage

```bash
/oss:review
/oss:review src/services/auth.ts
/oss:review --focus security
```
