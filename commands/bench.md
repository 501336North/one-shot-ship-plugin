---
description: Performance benchmarking and load testing
---

## Help

**Command:** `/oss:bench`

**Description:** Performance benchmarking and load testing

**Workflow Position:** build -> **BENCH** (Performance) -> ship

**Usage:**
```bash
/oss:bench [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| None | | All configuration via options |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |
| `--target` | | Specific endpoint or component to benchmark |

**Examples:**
```bash
# Run all benchmarks
/oss:bench

# Benchmark a specific API endpoint
/oss:bench --target api/users
```

**Related Commands:**
- `/oss:load` - Load testing at scale with k6
- `/oss:test` - Run comprehensive E2E tests
- `/oss:monitor` - Monitor production performance

---

# /oss:bench - Performance Benchmark

Performance benchmarking and load testing to stress test your application.

## What This Command Does

1. **Benchmark identification** - Key performance metrics
2. **Load test setup** - Configure test scenarios
3. **Test execution** - Run performance tests
4. **Analysis** - Identify bottlenecks and regressions

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
~/.oss/hooks/oss-log.sh init bench
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
~/.oss/hooks/oss-notify.sh --workflow bench start '{}'
```

## Step 5: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

This auto-installs the decrypt CLI if missing. Existing installations are unaffected.

## Step 6: Fetch and Decrypt Prompt

```bash
~/.oss/bin/oss-decrypt --type workflows --name bench
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 7: Execute the Fetched Prompt

The prompt handles:
- Baseline metrics collection
- Load test configuration
- Stress testing
- Performance regression detection

## Long-Running Operations

> **Tip**: Benchmarks can take several minutes to complete.
> Press **Ctrl+B** to move this operation to the background.
> You'll be notified when it completes and can continue other work.

## Example Usage

```bash
/oss:bench
/oss:bench --target api/users
```
