---
description: View and manage the task queue
---

## Help

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
| `SUBCOMMAND` | No | clear, remove, status (default: show queue) |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--verbose` | | Show full task details |
| `--priority` | | Filter by priority level (low, medium, high, critical) |

**Examples:**
```bash
# Show all pending tasks
/oss:queue

# Show queue with full details
/oss:queue --verbose

# Remove all tasks
/oss:queue clear

# Clear only low-priority tasks
/oss:queue clear --priority low

# Remove specific task by ID
/oss:queue remove task-20251206-143022-a1b2
```

**Related Commands:**
- `/oss:watcher` - Watcher agent management
- `/oss:legend` - Status line legend
- `/oss:build` - Execute queued tasks

---

# /oss:queue - Task Queue Management

View and manage queued tasks detected by the watcher agent.

## What This Command Does

1. **Shows queue status** - Displays pending tasks by priority
2. **Manages tasks** - Clear, remove, or inspect tasks
3. **Priority breakdown** - Shows count by priority level

## Usage

### View Queue

```bash
# Show all pending tasks
/oss:queue

# Show queue with full details
/oss:queue --verbose
```

### Clear Queue

```bash
# Remove all tasks
/oss:queue clear

# Clear only low-priority tasks
/oss:queue clear --priority low
```

### Remove Specific Task

```bash
# Remove by task ID
/oss:queue remove task-20251206-143022-a1b2
```

## Implementation

When this command runs:

1. **Read the queue file**:
```bash
cat .oss/queue.json
```

2. **Display summary**:
```
OSS Task Queue
━━━━━━━━━━━━━━━

Priority Breakdown:
  Critical: 0
  High:     2
  Medium:   1
  Low:      0

Total: 3 pending tasks
```

3. **If --verbose, show task details**:
```
Task: task-20251206-143022-a1b2
  Priority: high
  Type: test_failure
  Agent: debugger
  Prompt: Fix the failing test in auth.test.ts...
```

## Subcommands

### clear
Removes all tasks from the queue. Use with caution.

### remove <id>
Removes a specific task by its ID.

### status
Shows just the count without task details (default).

## File Locations

- Active queue: `.oss/queue.json`
- Failed tasks: `.oss/queue-failed.json`
- Expired tasks: `.oss/queue-expired.json`

## Examples

```bash
# Quick status check
/oss:queue

# See what's waiting
/oss:queue --verbose

# Start fresh
/oss:queue clear

# Skip a specific task
/oss:queue remove task-20251206-143022-a1b2
```

## Integration with preCommand Hook

The queue is automatically drained before each user command via the preCommand hook. Tasks execute in priority order:

1. Critical (execute immediately)
2. High (execute before user command)
3. Medium (execute when queue drains)
4. Low (execute when nothing else pending)

Use `--no-queue` flag on any command to skip queue drain:

```bash
/oss:plan --no-queue
```
