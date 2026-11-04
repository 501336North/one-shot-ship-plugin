---
name: create-dev-docs
description: Setup feature branch and development documentation structure
model: haiku
---

# OSS Create Dev Docs

Create feature branch with comprehensive dev docs for context preservation.

## Step 1: Check Authentication

```bash
test -f "$HOME/.oss/config.json" && grep -qE '"apiKey"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]' "$HOME/.oss/config.json" && echo "API key configured"
```

If no API key found, instruct user to run `/oss login`.

## Step 2: Fetch and Decrypt Prompt

Ensure the decrypt CLI is installed:

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

Fetch and decrypt the prompt:

```bash
~/.oss/bin/oss-decrypt --type workflows --name create-dev-docs
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line and carry on with this file's own instructions; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 3: Execute the Fetched Prompt

The prompt creates:
- Feature branch (feature/<name>)
- dev/active/<feature>/ directory structure
- README.md (quick resume guide)
- CONTEXT.md (full strategic context)
- TASKS.md (detailed TDD task breakdown)
- PROGRESS.md (session-by-session history)

This enables context restoration with `/dev:resume-dev-docs` after compaction.

## Step 4: Handle Errors

Same error handling as other skills:

**401 Unauthorized**:
```
Error: API key invalid or missing
→ Run: /oss login
```

**403 Subscription Expired**:
```
Error: Your subscription has expired
→ Upgrade at: https://www.oneshotship.com/pricing
```

**500 Server Error**:
```
Error: Server error occurred
→ Try again or contact support
```

## Example Usage

```
/oss create-dev-docs user-authentication
```

Creates branch and docs structure for user-authentication feature.
