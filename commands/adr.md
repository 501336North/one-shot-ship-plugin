---
description: Create Architecture Decision Records
---

# /oss:adr - Architecture Decision Records

Document architectural decisions with context, options, and rationale.

## What This Command Does

1. **Captures context** - Why the decision is needed
2. **Lists options** - Alternatives considered
3. **Documents decision** - Chosen approach and why
4. **Records consequences** - Trade-offs and implications

## ADR Format

Standard ADR structure:
- **Title**: Short descriptive name
- **Status**: Proposed, Accepted, Deprecated, Superseded
- **Context**: What prompted this decision
- **Decision**: What we decided to do
- **Consequences**: What this means going forward

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init adr
```

## Step 3: Send Start Notification

**You MUST execute this notification command before proceeding.**

```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow adr start '{}'
```

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/adr
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 4: Execute the Fetched Prompt

The prompt guides you through:
- Describing the decision context
- Listing options considered
- Documenting the chosen approach
- Recording trade-offs and consequences
- Creating ADR file in standard format

## Step 5: Send Completion Notification

**You MUST execute the appropriate notification command.**

On success (ADR created):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow adr complete '{"adrNumber": {NUMBER}, "title": "{TITLE}"}'
```

On failure (couldn't create ADR):
```bash
$CLAUDE_PLUGIN_ROOT/hooks/oss-notify.sh --workflow adr failed '{"reason": "{REASON}"}'
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
/oss:adr "Use London TDD for all new development"
/oss:adr --title "Database selection" --decision "PostgreSQL"
```
