---
description: View and manage the task queue
model: sonnet
---

## Help

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

**Command:** `/oss:queue`

**Description:** View and manage the task queue

**Workflow Position:** any time - **QUEUE** management

**Usage:**
```bash
/oss:queue [SUBCOMMAND] [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `SUBCOMMAND` | No | add, status, drain, schedule, remove, clear (default: status) |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--issue` | | GitHub issue URL to add |
| `--review` | | PR URL for review-only item |
| `--shared` | | Add to team shared queue |
| `--verbose` | | Show full task details |

**Examples:**
```text
# Show queue status
/oss:queue status

# Add a free-form item
/oss:queue add "Build user profile page"

# Add from GitHub issue
/oss:queue add --issue https://github.com/org/repo/issues/42

# Add PR for review only
/oss:queue add --review https://github.com/org/repo/pull/7

# Add to shared team queue
/oss:queue add --shared "Refactor auth module"

# Drain queue immediately
/oss:queue drain

# Schedule overnight execution
/oss:queue schedule

# Remove specific item
/oss:queue remove <id>

# Clear all items
/oss:queue clear
```

**Related Commands:**
- `/oss:build` - Execute queued tasks
- `/oss:watcher` - Watcher agent management
- `/oss:legend` - Status line legend

---

# /oss:queue - Batch Queue Runner

Manage a work queue of features, issues, and PR reviews. Queue items for unattended execution via plan→build→ship pipeline.

## Step 1: Check Authentication

```bash
test -f "$HOME/.oss/config.json" && grep -qE '"apiKey"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]' "$HOME/.oss/config.json" && echo "API key configured"
```

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Ensure Decrypt CLI Installed

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

## Step 3: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name queue
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line what happened (rate limited, offline, or not logged in, so run /oss:login) and STOP this command; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 4: Execute the Fetched Prompt

The decrypted prompt contains full subcommand logic for add, status, drain, schedule, remove, and clear. Execute it with the ARGUMENTS passed by the user (the subcommand and any flags).

**ARGUMENTS passthrough:** The user's subcommand (e.g., `add`, `status`, `drain`) and flags (e.g., `--issue`, `--shared`) are available in the ARGUMENTS variable. Pass them to the fetched prompt for parsing.

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
