---
description: Execute custom team commands with full observability
estimated_tokens: 2000-5000
---

## Help

**Command:** `/oss:custom`

**Description:** Execute a custom command defined by your team (with `team:` prefix).

**Workflow Position:** Can be inserted anywhere in the workflow chain (ideate → plan → **CUSTOM** → build → ship)

**Usage:**
```bash
/oss:custom <command-name>
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| command-name | Yes | The custom command name (with or without `team:` prefix) |

**Examples:**
```bash
# Execute a custom command
/oss:custom team:review-standards

# Without prefix (team: is added automatically)
/oss:custom review-standards
```

**Related Commands:**
- `/oss:build` - Execute TDD implementation after custom steps
- `/oss:workflows` - View and manage workflow configuration

---

# /oss:custom - Execute Custom Team Commands

Execute a custom command defined by your team with full observability.

## What This Command Does

1. **Fetches custom prompt** - Retrieves team-specific command from API
2. **Executes with observability** - Full logging, status updates, IRON LAWS compliance
3. **Integrates with workflow** - Works within workflow chains (blocking or non-blocking)

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
~/.oss/hooks/oss-log.sh init custom
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```bash
~/.oss/hooks/fetch-iron-laws.sh
```

**All IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 4: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow custom start '{"command": "{COMMAND_NAME}"}'
```

Replace `{COMMAND_NAME}` with the actual custom command name (without `team:` prefix).

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch Custom Command Prompt

Strip the `team:` prefix if present and fetch the custom command:

```bash
# Parse command name (strip team: prefix if present)
COMMAND_NAME="${1#team:}"

# Fetch custom command prompt from API
~/.oss/bin/oss-decrypt --type custom --name "$COMMAND_NAME"
```

The decrypt CLI fetches the prompt from `/api/v1/prompts/custom/{name}` and returns the decrypted prompt content.

### API Response Format

The endpoint returns:
```json
{
  "prompt": "The custom command prompt content...",
  "name": "review-standards",
  "displayName": "Review Standards",
  "isBlocking": true
}
```

## Step 7: Execute the Fetched Prompt

Execute the prompt content returned by the API. The prompt will guide the workflow step.

**Handling Blocking Behavior:**
- If `isBlocking: true` and the command fails, stop the workflow chain
- If `isBlocking: false`, log the result but continue the workflow

## Step 8: Update Status Line (Completion)

**You MUST update the workflow status on completion.**

After custom command completes:
```bash
~/.oss/hooks/oss-notify.sh --workflow custom complete '{"command": "{COMMAND_NAME}"}'
```

If custom command fails:
```bash
~/.oss/hooks/oss-notify.sh --workflow custom failed '{"command": "{COMMAND_NAME}", "error": "{ERROR_MSG}"}'
```

## Error Handling

### If API returns 401
```
Authentication failed. Run: /oss:login
```

### If API returns 403
```
Subscription expired or insufficient permissions.
Upgrade at: https://www.oneshotship.com/pricing
```

### If API returns 404
```
Custom command '{COMMAND_NAME}' not found.
Check your team's custom commands at: https://www.oneshotship.com/dashboard/commands
```

### If API returns 500
```
API temporarily unavailable. Contact support@oneshotship.com
```

## Integration with Workflow Chains

Custom commands integrate with workflow chains:

```yaml
# Example workflow config with custom command
build:
  chains_to:
    - team:review-standards  # Custom command after build
    - ship
```

The workflow engine detects the `team:` prefix and executes via this command pattern.

## Plan Limits

Custom command availability by plan:
| Plan | Custom Commands |
|------|-----------------|
| TRIAL | 0 |
| PRO | 1 |
| TEAM | 10 |
| ENTERPRISE | Unlimited |

## Example Use Cases

1. **Review Standards** - Run code review against team standards after build
2. **Clarify Requirements** - Ask clarifying questions after ideate
3. **Security Scan** - Custom security checks before ship
4. **Documentation Check** - Verify docs are updated before PR
