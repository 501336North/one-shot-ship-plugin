---
description: Monitor production health with real-time metrics and alerting
---

## Help

**Command:** `/oss:monitor`

**Description:** Monitor production health with real-time metrics and alerting

**Workflow Position:** deploy -> **MONITOR** -> incident

**Usage:**
```bash
/oss:monitor [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--detailed` | | Show detailed metrics and logs |

**Examples:**
```bash
# Monitor production health
/oss:monitor

# Show detailed metrics
/oss:monitor --detailed
```

**Related Commands:**
- `/oss:deploy` - Deploy before monitoring
- `/oss:incident` - Respond to issues detected
- `/oss:rollback` - Emergency rollback if critical issues
- `/oss:trace` - Distributed tracing analysis

---

# /oss:monitor - Watch the Lighthouse

Monitor production health with real-time metrics, error tracking, and alerting.

## What This Command Does

1. **Health checks** - Service availability
2. **Metrics review** - Key performance indicators
3. **Error tracking** - Recent errors and trends
4. **Alert status** - Active alerts and incidents

## Step 1: Check Authentication

```bash
test -f "$HOME/.oss/config.json" && grep -qE '"apiKey"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]' "$HOME/.oss/config.json" && echo "API key configured"
```

If no API key found:
```
No API key found. Run: /oss:login
Register at https://www.oneshotship.com
```

## Step 2: Initialize Logging

**You MUST initialize logging for supervisor visibility.**

```bash
~/.oss/hooks/oss-log.sh init monitor
```

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow monitor start '{}'
```

## Step 4: Ensure Decrypt CLI Installed

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 5: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name monitor
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line what happened (rate limited, offline, or not logged in, so run /oss:login) and STOP this command; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 6: Execute the Fetched Prompt

The prompt monitors:
- Uptime and availability
- Response times (p50, p95, p99)
- Error rates
- Resource utilization

## Step 7: Update Status Line (Completion)

On success only. If the command failed (the prompt sent `failed`), do not send `complete`.

**You MUST update the workflow status on completion.**

```bash
~/.oss/hooks/oss-notify.sh --workflow monitor complete '{}'
```

## Command Chain

```
/oss:deploy      → Deploy to production
    ↓
/oss:release     → Create versioned release
    ↓
/oss:monitor     → Watch production health (YOU ARE HERE)
    │
    ├── If issues detected:
    │   /oss:incident  → Declare incident
    │       ↓
    │       /oss:rollback  → Emergency rollback
    │
    └── If healthy:
        → Continue monitoring
```

**Previous**: `/oss:release` (versioned release created)
**Next**: `/oss:incident` (if issues) or continue monitoring

## Example Usage

```bash
/oss:monitor
/oss:monitor --detailed
```
