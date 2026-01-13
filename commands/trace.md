---
description: Distributed tracing analysis with OpenTelemetry
---

## Help

**Command:** `/oss:trace`

**Description:** Distributed tracing analysis with OpenTelemetry

**Workflow Position:** any time - **TRACE** (distributed tracing)

**Usage:**
```bash
/oss:trace [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--trace-id` | | Specific trace ID to analyze |
| `--slow-spans` | | Find slow spans |

**Examples:**
```bash
# Analyze a specific trace
/oss:trace --trace-id abc123

# Find slow spans
/oss:trace --slow-spans
```

**Related Commands:**
- `/oss:debug` - Debug issues found in traces
- `/oss:monitor` - Production health monitoring
- `/oss:bench` - Performance benchmarking

---

# /oss:trace - Distributed Tracing

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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init trace
```

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/commands/trace
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

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
/oss:trace --trace-id abc123
/oss:trace --slow-spans
```
