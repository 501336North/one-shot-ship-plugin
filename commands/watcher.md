---
description: Manage the background watcher agent
---

# /oss:watcher - Watcher Management

Control and monitor the background watcher agent that detects anomalies.

## What This Command Does

1. **Shows watcher status** - Running/stopped state
2. **Controls watcher** - Start, stop, restart
3. **Views logs** - Recent watcher activity

## Usage

### Check Status

```bash
# Show watcher status
/oss:watcher

# Show status with recent logs
/oss:watcher --logs
```

### Control Watcher

```bash
# Restart watcher
/oss:watcher restart

# Stop watcher
/oss:watcher stop

# Start watcher (usually automatic)
/oss:watcher start
```

### View Logs

```bash
# Show recent watcher logs
/oss:watcher logs

# Show last N lines
/oss:watcher logs --lines 50
```

## Implementation

When this command runs:

1. **Check PID file**:
```bash
cat .oss/watcher.pid 2>/dev/null
```

2. **Verify process running**:
```bash
ps -p $PID > /dev/null 2>&1
```

3. **Display status**:
```
OSS Watcher Status
━━━━━━━━━━━━━━━━━━

Status: Running
PID: 12345
Uptime: 2h 15m

Monitors Active:
  ✓ Log Monitor
  ✓ Test Monitor
  ✓ Git/CI Monitor

Queue: 3 tasks pending
```

## Subcommands

### status (default)
Shows current watcher state and monitors.

### start
Starts the watcher if not running.

### stop
Gracefully stops the watcher.

### restart
Stops and restarts the watcher.

### logs
Shows recent watcher log entries.

## File Locations

- PID file: `.oss/watcher.pid`
- Log file: `.oss/watcher.log`
- Config: `.oss/config.json`

## Configuration

The watcher can be configured via `.oss/config.json`:

```json
{
  "version": "1.0",
  "enabled": true,
  "monitors": {
    "logs": true,
    "tests": true,
    "git": true
  },
  "loop_detection_threshold": 5,
  "stuck_timeout_seconds": 60,
  "task_expiry_hours": 24,
  "max_queue_size": 50,
  "use_llm_analysis": true,
  "llm_confidence_threshold": 0.7
}
```

## Automatic Startup

The watcher starts automatically on session start via the SessionStart hook. It runs as a singleton - only one watcher per project.

## Troubleshooting

### Watcher not starting
```bash
# Check for stale PID file
cat .oss/watcher.pid

# Remove stale PID
rm .oss/watcher.pid

# Restart
/oss:watcher start
```

### Watcher crashing
```bash
# Check logs for errors
/oss:watcher logs

# Check Node.js version
node --version  # Should be 18+
```

### Queue not draining
```bash
# Check queue status
/oss:queue

# Verify preCommand hook is active
cat ~/.claude-oss/plugins/cache/oss/hooks/hooks.json
```
