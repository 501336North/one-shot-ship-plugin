---
name: performance-benchmark
description: Performance benchmarking and load testing. Use for performance analysis.
---

# OSS Performance Benchmark

Comprehensive performance testing and analysis.

## Step 1: Check Authentication

```bash
~/.oss/hooks/oss-value.sh keycheck
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Prompt from API

Install the decrypt CLI if it is missing (a fresh install has none yet):

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

```bash
~/.oss/bin/oss-decrypt --type workflows --name performance-benchmark
```

## Step 3: Execute the Fetched Prompt

The prompt runs:
- Baseline metrics collection
- Unit performance tests
- Load testing (10 virtual users)
- Stress testing (100 virtual users)
- Database performance benchmarks
- Memory leak detection
- Regression testing
- Performance report generation

## Error Handling

### If API returns 401
```
Authentication failed. Run: /oss login
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

```
/oss performance-benchmark
```

Runs comprehensive performance test suite and generates report.
