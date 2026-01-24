---
description: View and manage your team's workflow configuration
---

## Help

**Command:** `/oss:workflows`

**Description:** View your team's workflow configuration for ideate, plan, build, and ship workflows.

**Workflow Position:** any time - **WORKFLOWS** config viewer

**Usage:**
```bash
/oss:workflows [OPTIONS] [WORKFLOW_NAME]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `WORKFLOW_NAME` | No | Specific workflow to show (ideate, plan, build, ship) |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# List all workflows with customization status
/oss:workflows

# Show specific workflow config
/oss:workflows ideate
/oss:workflows plan
/oss:workflows build
/oss:workflows ship
```

**Related Commands:**
- `/oss:status` - Check subscription status
- `/oss:settings` - Configure preferences
- `/oss:login` - Authenticate with API key

---

# /oss:workflows - View Workflow Configuration

View and manage your team's customizable workflow configuration.

## What This Command Does

1. **Lists all workflows** - Shows ideate, plan, build, ship with customization status
2. **Shows chain configuration** - What commands run after each workflow
3. **Shows agent configuration** - Which agents are spawned
4. **Indicates customization** - Whether using default or custom config

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Workflow List

Call the workflows API endpoint to get the list:

```
URL: https://one-shot-ship-api.onrender.com/api/v1/workflows
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

Response:
```json
{
  "workflows": [
    { "name": "ideate", "customized": false },
    { "name": "plan", "customized": false },
    { "name": "build", "customized": true },
    { "name": "ship", "customized": false }
  ]
}
```

## Step 3: Display Workflow List

```
==============================================
     WORKFLOW CONFIGURATION
==============================================

Workflow      Status
----------    --------
ideate        DEFAULT
plan          DEFAULT
build         CUSTOM    <-- Team has customized this
ship          DEFAULT

==============================================
Run: /oss:workflows {name} to see details
Dashboard: https://www.oneshotship.com/dashboard
==============================================
```

## Step 4: Show Specific Workflow (Optional)

If a workflow name is provided, fetch and display its configuration:

```
URL: https://one-shot-ship-api.onrender.com/api/v1/workflows/{workflowName}
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

Display the decrypted configuration:

```
==============================================
     WORKFLOW: ideate
==============================================

Status: DEFAULT (using default configuration)

Chain Configuration:
  1. requirements      [always]
  2. api-design        [if has_api_work]
  3. data-model        [if has_db_work]
  4. adr               [always]

Agents:
  (none configured for this workflow)

Checkpoint: human (waits for approval)

==============================================
Customize at: https://www.oneshotship.com/dashboard/settings/workflows/ideate
==============================================
```

## Example: Build Workflow Config

```
==============================================
     WORKFLOW: build
==============================================

Status: CUSTOM (team-customized configuration)

TDD Loop:
  red -> green -> refactor

Chain Configuration:
  1. integration       [always]

Agents:
  1. code-simplifier   [always]
  2. frontend-design   [if has_ui_work]

Checkpoint: auto (continues automatically)

==============================================
Customize at: https://www.oneshotship.com/dashboard/settings/workflows/build
==============================================
```

## Example: Ship Workflow Config

```
==============================================
     WORKFLOW: ship
==============================================

Status: DEFAULT (using default configuration)

Quality Gates (parallel):
  - code-reviewer
  - performance-engineer
  - security-auditor
  - penetration-tester
  All must pass: YES

On Pass:
  Actions: commit, create_pr
  Never: push_to_main

Checkpoint: human (waits for approval)

==============================================
Customize at: https://www.oneshotship.com/dashboard/settings/workflows/ship
==============================================
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

## Customization

Your team can customize workflow configurations through the dashboard:

1. Go to https://www.oneshotship.com/dashboard
2. Navigate to Settings > Workflows
3. Select a workflow to customize
4. Modify chain order, add/remove agents, change checkpoints
5. Save changes

Changes take effect immediately for all team members.
