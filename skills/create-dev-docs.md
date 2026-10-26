---
name: create-dev-docs
description: Setup feature branch and development documentation structure
model: haiku
---

# OSS Create Dev Docs

Create feature branch with comprehensive dev docs for context preservation.

## Step 1: Check Authentication

```bash
~/.oss/hooks/oss-value.sh keycheck
```

If no API key found, instruct user to run `/oss login`.

## Step 2: Fetch Prompt from API

```bash
~/.oss/bin/oss-decrypt --type workflows --name create-dev-docs
```

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
