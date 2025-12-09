---
description: Performance benchmarking and load testing
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
$CLAUDE_PLUGIN_ROOT/hooks/oss-log.sh init bench
```

## Step 3: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/bench
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt handles:
- Baseline metrics collection
- Load test configuration
- Stress testing
- Performance regression detection

## Example Usage

```bash
/oss:bench
/oss:bench --target api/users
```
