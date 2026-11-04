---
description: View and manage your team's workflow configuration
model: haiku
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

## Step 1: Fetch Workflow List

**OSS hooks older than this plugin:** if a `~/.oss/hooks/oss-value.sh` call in this command (Step 1 or Step 3) prints `usage: oss-value.sh` or `No such file or directory` (any case: zsh prints `no such file or directory`), the plugin was updated after this session started and `~/.oss/hooks` still holds the older copies. Do not show that output; show only this line: `Your OSS hooks are older than the plugin; restart Claude Code (or start a new session) to update them.` and stop.

Run this exactly as written (one allowed call). It sends the key from your OSS config to `/api/v1/workflows` on the API that config's `apiUrl` names, on curl's stdin (never on a command line or into this chat), and prints one line per workflow, its name and `DEFAULT` or `CUSTOM`:

```bash
~/.oss/hooks/oss-value.sh workflows
```

If it fails, show its message and stop (see Error Handling; `No API key found` means run `/oss:login`).

Output:
```text
ideate DEFAULT
plan DEFAULT
build CUSTOM
ship DEFAULT
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 2: Display Workflow List

```text
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

## Step 3: Show Specific Workflow (Optional)

If a workflow name is provided, fetch and display its configuration. The name reaches the shell through the value folder: run `~/.oss/hooks/oss-value.sh dir`, use the Write tool to write the name alone to `workflow.txt` in the folder it printed, then run this exactly as written (one allowed call):

```bash
~/.oss/hooks/oss-value.sh workflow
```

It reads the name from `workflow.txt` only when it is a valid workflow name (a lower-case letter, then lower case, digits or `-`) and deletes the file, then fetches that workflow's configuration from `/api/v1/workflows/<name>/editor` the same key-safe way and prints it as JSON (`name`, `chain`, `agents`, `parallel_agents`, `task_loop`, `quality_gates`, `on_pass`, `checkpoint`). If it says `refused`, tell the user the name is not valid and stop. If it fails otherwise, show its message and stop (`HTTP 404`: not one of ideate, plan, build, ship).

Display the configuration (Status is the `DEFAULT` or `CUSTOM` that Step 1 listed for this workflow):

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
  2. ui-review          [if has_ui_work]

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
