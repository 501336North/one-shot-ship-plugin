---
name: performance-benchmark
description: Performance benchmarking and load testing. Use for performance analysis.
---

# OSS Performance Benchmark

Comprehensive performance testing and analysis.

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/performance-benchmark
Method: GET
Headers:
  Authorization: Bearer {apiKey}
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
