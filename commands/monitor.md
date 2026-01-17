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
~/.oss/hooks/oss-log.sh init monitor
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```bash
~/.oss/hooks/fetch-iron-laws.sh
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/monitor
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt monitors:
- Uptime and availability
- Response times (p50, p95, p99)
- Error rates
- Resource utilization

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
