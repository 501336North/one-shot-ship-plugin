---
description: Load testing at scale with k6
---

## Help

**Command:** `/oss:load`

**Description:** Load testing at scale with k6

**Workflow Position:** stage -> **LOAD** (Load testing) -> deploy

**Usage:**
```bash
/oss:load [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--vus` | | Number of virtual users (e.g., 100) |
| `--duration` | | Test duration (e.g., 5m, 1h) |
| `--scenario` | | Predefined scenario: spike, stress, soak |

**Examples:**
```bash
# Run load test with 100 virtual users for 5 minutes
/oss:load --vus 100 --duration 5m

# Run a spike test scenario
/oss:load --scenario spike
```

**Related Commands:**
- `/oss:bench` - Performance benchmarking
- `/oss:stage` - Deploy to staging before load testing
- `/oss:deploy` - Deploy after load testing passes
- `/oss:monitor` - Monitor production under load

---

# /oss:load - Load Testing

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
~/.oss/hooks/oss-log.sh init load
```

## Step 3: Fetch IRON LAWS (MANDATORY)

Before executing, fetch and review the IRON LAWS:
```bash
~/.oss/hooks/fetch-iron-laws.sh
```

**All 5 IRON LAWS must be followed. Self-correct any violations before proceeding.**

## Step 4: Update Status Line (Start)

**You MUST update the workflow status before proceeding.**

```bash
~/.oss/hooks/oss-notify.sh --workflow load start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name load
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

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

## Long-Running Operations

> **Tip**: Load tests can run for extended periods (5+ minutes).
> Press **Ctrl+B** to move this operation to the background.
> You'll be notified when it completes and can continue other work.

## Example Usage

```bash
/oss:load --vus 100 --duration 5m
/oss:load --scenario spike
```
