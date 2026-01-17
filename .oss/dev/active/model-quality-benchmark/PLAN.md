# TDD Implementation Plan: Model Quality Benchmark System

Validate the claim: **"95% of the quality for 20% of the tokens"**

## Overview

**Feature:** Model Quality Benchmark System
**Goal:** Compare model quality and cost across providers (Claude, OpenRouter, Ollama) with quantified metrics
**Status:** Planning

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Model Quality Benchmark System                        │
│                                                                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐      │
│  │ BenchmarkTask   │    │ BenchmarkRunner │    │ QualityEvaluator│      │
│  │                 │    │                 │    │                 │      │
│  │ • Code review   │───▶│ • Run via proxy │───▶│ • LLM-as-judge  │      │
│  │ • Bug fix       │    │ • Capture tokens│    │ • Automated     │      │
│  │ • Test writing  │    │ • Track latency │    │ • Human (opt)   │      │
│  │ • Refactoring   │    │ • Store results │    │ • Score 0-100   │      │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘      │
│           │                      │                      │               │
│           ▼                      ▼                      ▼               │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                     BenchmarkReporter                             │   │
│  │                                                                   │   │
│  │  Provider       Tokens    Cost     Quality   Quality/Token Ratio  │   │
│  │  ──────────────────────────────────────────────────────────────   │   │
│  │  Claude         10,000    $0.15    100%      baseline             │   │
│  │  OpenRouter     2,500     $0.01    96%       3.84x better         │   │
│  │  Ollama         2,200     $0.00    94%       4.27x better         │   │
│  │                                                                   │   │
│  │  Claim Validation: ✅ 95%+ quality at 22% tokens (4.5x savings)   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Existing Code to Leverage

| Component | File | Purpose |
|-----------|------|---------|
| CostTracker | `src/services/cost-tracker.ts` | Token/cost tracking, pricing tables |
| MetricsCollector | `src/services/metrics-collector.ts` | Session timing, aggregation patterns |
| SpecMetricsService | `src/services/spec-metrics.ts` | Historical tracking, trend analysis |
| ModelProxy | `src/services/model-proxy.ts` | HTTP proxy for model requests |
| HandlerRegistry | `src/services/handler-registry.ts` | Provider-based routing |

---

## Phase 1: Benchmark Task Definitions (3 tasks, ~12 tests)

Define standardized tasks for consistent model comparison.

### Task 1.1: Define BenchmarkTask Types
**Tests:** 4
```typescript
// test/services/benchmark/types.test.ts
describe('BenchmarkTask types', () => {
  it('should define BenchmarkTask interface with id, name, prompt, expectedBehavior');
  it('should define BenchmarkResult interface with tokens, latency, output, score');
  it('should define QualityDimension enum (correctness, completeness, style, efficiency)');
  it('should define TaskCategory enum (code-review, bug-fix, test-writing, refactoring)');
});
```

### Task 1.2: Create Benchmark Task Registry
**Tests:** 4
```typescript
describe('BenchmarkTaskRegistry', () => {
  it('should register a benchmark task');
  it('should get task by id');
  it('should list all tasks by category');
  it('should validate task has expected output pattern');
});
```

### Task 1.3: Implement Standard Task Set
**Tests:** 4
```typescript
describe('Standard benchmark tasks', () => {
  it('should include code-review task with sample code and expected issues');
  it('should include bug-fix task with buggy code and expected fix');
  it('should include test-writing task with function and expected test');
  it('should include refactoring task with messy code and expected clean version');
});
```

---

## Phase 2: Benchmark Runner (4 tasks, ~16 tests)

Execute tasks through different providers and collect metrics.

### Task 2.1: Create BenchmarkRunner Class
**Tests:** 4
```typescript
// test/services/benchmark/runner.test.ts
describe('BenchmarkRunner constructor', () => {
  it('should accept list of providers to benchmark');
  it('should accept benchmark tasks to run');
  it('should accept CostTracker instance for cost tracking');
  it('should accept optional timeout per request');
});
```

### Task 2.2: Implement Single Task Execution
**Tests:** 4
```typescript
describe('BenchmarkRunner.runTask()', () => {
  it('should send task prompt to provider via proxy');
  it('should capture input/output tokens from response');
  it('should capture latency (time to first token, total time)');
  it('should handle provider errors gracefully');
});
```

### Task 2.3: Implement Batch Execution
**Tests:** 4
```typescript
describe('BenchmarkRunner.runBenchmark()', () => {
  it('should run all tasks through all providers');
  it('should run Claude first as baseline');
  it('should aggregate results by provider');
  it('should support parallel execution per provider');
});
```

### Task 2.4: Implement Result Storage
**Tests:** 4
```typescript
describe('BenchmarkRunner result storage', () => {
  it('should store raw outputs for quality evaluation');
  it('should store token counts per task per provider');
  it('should store latency metrics');
  it('should persist results to .oss/benchmarks/{date}.json');
});
```

---

## Phase 3: Quality Evaluator (4 tasks, ~16 tests)

LLM-as-judge for scoring model outputs.

### Task 3.1: Define Quality Evaluation Protocol
**Tests:** 4
```typescript
// test/services/benchmark/evaluator.test.ts
describe('QualityEvaluator protocol', () => {
  it('should define evaluation prompt template');
  it('should score on 4 dimensions (correctness, completeness, style, efficiency)');
  it('should return overall score 0-100');
  it('should include reasoning for each dimension');
});
```

### Task 3.2: Implement LLM-as-Judge Evaluator
**Tests:** 4
```typescript
describe('LLMJudgeEvaluator', () => {
  it('should compare candidate output to reference (Claude baseline)');
  it('should use Claude as the judge (via native API)');
  it('should parse structured JSON response');
  it('should handle evaluation failures gracefully');
});
```

### Task 3.3: Implement Automated Metrics
**Tests:** 4
```typescript
describe('AutomatedEvaluator', () => {
  it('should check if code compiles/parses');
  it('should check if tests pass (for test-writing task)');
  it('should check code similarity to expected output');
  it('should combine automated metrics into score');
});
```

### Task 3.4: Implement Composite Evaluator
**Tests:** 4
```typescript
describe('CompositeEvaluator', () => {
  it('should combine LLM judge score (70% weight)');
  it('should combine automated metrics (30% weight)');
  it('should normalize to 0-100 scale');
  it('should flag low-confidence evaluations');
});
```

---

## Phase 4: Benchmark Reporter (3 tasks, ~12 tests)

Generate comparison reports and validate claims.

### Task 4.1: Calculate Comparative Metrics
**Tests:** 4
```typescript
// test/services/benchmark/reporter.test.ts
describe('BenchmarkReporter metrics', () => {
  it('should calculate quality percentage vs baseline (Claude = 100%)');
  it('should calculate token percentage vs baseline');
  it('should calculate cost savings percentage');
  it('should calculate quality-per-token ratio');
});
```

### Task 4.2: Generate Report Data
**Tests:** 4
```typescript
describe('BenchmarkReporter.generateReport()', () => {
  it('should include per-provider summary');
  it('should include per-task breakdown');
  it('should include trend data if historical results exist');
  it('should include claim validation (95% quality / 20% tokens)');
});
```

### Task 4.3: Format Report Output
**Tests:** 4
```typescript
describe('BenchmarkReporter formatting', () => {
  it('should output markdown table format');
  it('should output JSON for programmatic access');
  it('should highlight claim validation status');
  it('should include recommendations based on results');
});
```

---

## Phase 5: CLI & Integration (3 tasks, ~12 tests)

Command-line interface for running benchmarks.

### Task 5.1: Create benchmark CLI Command
**Tests:** 4
```typescript
// test/cli/benchmark.test.ts
describe('benchmark CLI arguments', () => {
  it('should accept --providers flag (comma-separated)');
  it('should accept --tasks flag (all, code-review, bug-fix, etc.)');
  it('should accept --output flag for report path');
  it('should accept --compare flag to compare with previous run');
});
```

### Task 5.2: Implement CLI Execution
**Tests:** 4
```typescript
describe('benchmark CLI execution', () => {
  it('should start proxy for each provider');
  it('should run benchmark suite');
  it('should evaluate quality');
  it('should output report to console and file');
});
```

### Task 5.3: Integrate with /oss:models
**Tests:** 4
```typescript
describe('benchmark integration', () => {
  it('should add "benchmark" subcommand to /oss:models');
  it('should store benchmark results in cost tracker data');
  it('should update /oss:models costs with quality data');
  it('should recommend optimal model based on quality/cost ratio');
});
```

---

## Summary

| Phase | Tasks | Estimated Tests |
|-------|-------|-----------------|
| Phase 1: Benchmark Task Definitions | 3 | 12 |
| Phase 2: Benchmark Runner | 4 | 16 |
| Phase 3: Quality Evaluator | 4 | 16 |
| Phase 4: Benchmark Reporter | 3 | 12 |
| Phase 5: CLI & Integration | 3 | 12 |
| **Total** | **17** | **~68** |

## Files to Create

**New Files:**
- `watcher/src/services/benchmark/types.ts`
- `watcher/src/services/benchmark/task-registry.ts`
- `watcher/src/services/benchmark/standard-tasks.ts`
- `watcher/src/services/benchmark/runner.ts`
- `watcher/src/services/benchmark/evaluator.ts`
- `watcher/src/services/benchmark/reporter.ts`
- `watcher/src/cli/benchmark.ts`
- `watcher/test/services/benchmark/*.test.ts`
- `watcher/test/cli/benchmark.test.ts`

**Modified Files:**
- `commands/models.md` - Add benchmark subcommand

## Standard Benchmark Tasks

### Task: Code Review
```typescript
{
  id: 'code-review-01',
  name: 'Review function for issues',
  category: 'code-review',
  prompt: `Review this function and identify issues:
    function processData(data) {
      for (var i = 0; i < data.length; i++) {
        console.log(data[i])
        if (data[i] == null) continue
        results.push(data[i] * 2)
      }
      return results
    }`,
  expectedIssues: [
    'Undeclared variable: results',
    'Use const/let instead of var',
    'Missing type annotations',
    'console.log in production code',
    'Use === instead of =='
  ]
}
```

### Task: Bug Fix
```typescript
{
  id: 'bug-fix-01',
  name: 'Fix off-by-one error',
  category: 'bug-fix',
  prompt: `Fix the bug in this function:
    function getLastNItems(arr, n) {
      return arr.slice(arr.length - n - 1);
    }
    // Expected: getLastNItems([1,2,3,4,5], 2) => [4, 5]
    // Actual: getLastNItems([1,2,3,4,5], 2) => [3, 4, 5]`,
  expectedFix: 'arr.slice(arr.length - n)'
}
```

### Task: Test Writing
```typescript
{
  id: 'test-writing-01',
  name: 'Write tests for add function',
  category: 'test-writing',
  prompt: `Write unit tests for this function:
    function add(a: number, b: number): number {
      return a + b;
    }`,
  expectedTests: [
    'should add two positive numbers',
    'should add negative numbers',
    'should handle zero',
    'should handle decimal numbers'
  ]
}
```

### Task: Refactoring
```typescript
{
  id: 'refactor-01',
  name: 'Extract method from complex function',
  category: 'refactoring',
  prompt: `Refactor this function to be more readable:
    function processUser(user) {
      if (!user.email || !user.email.includes('@')) return false;
      if (user.age < 18) return false;
      if (user.country === 'blocked') return false;
      const hash = crypto.createHash('sha256').update(user.password).digest('hex');
      db.save({ ...user, password: hash, verified: false });
      email.send(user.email, 'Welcome!');
      return true;
    }`,
  expectedPatterns: [
    'Extract validation function',
    'Extract password hashing',
    'Single responsibility'
  ]
}
```

## Quality Evaluation Prompt Template

```
You are a code quality evaluator. Compare the CANDIDATE output against the REFERENCE (Claude baseline).

TASK: {task.name}
PROMPT: {task.prompt}

REFERENCE OUTPUT (Claude - 100% quality baseline):
{reference_output}

CANDIDATE OUTPUT ({provider}):
{candidate_output}

Score the candidate on these dimensions (0-100 each):

1. **Correctness**: Does it solve the problem correctly?
2. **Completeness**: Does it address all aspects of the task?
3. **Style**: Is the code/explanation well-formatted and clear?
4. **Efficiency**: Is the solution efficient and idiomatic?

Respond in JSON:
{
  "correctness": { "score": 0-100, "reasoning": "..." },
  "completeness": { "score": 0-100, "reasoning": "..." },
  "style": { "score": 0-100, "reasoning": "..." },
  "efficiency": { "score": 0-100, "reasoning": "..." },
  "overall_score": 0-100,
  "summary": "Brief comparison summary"
}
```

## Claim Validation Criteria

The benchmark validates: **"95% of the quality for 20% of the tokens"**

| Metric | Target | Measurement |
|--------|--------|-------------|
| Quality Score | ≥ 95% | Average overall_score vs Claude baseline |
| Token Usage | ≤ 20% | Total tokens / Claude total tokens |
| Cost Savings | ≥ 80% | (Claude cost - Provider cost) / Claude cost |

**Validation Logic:**
```typescript
function validateClaim(results: BenchmarkResults): ClaimValidation {
  const claudeBaseline = results.providers['claude'];

  for (const [provider, data] of Object.entries(results.providers)) {
    if (provider === 'claude') continue;

    const qualityRatio = data.avgQualityScore / claudeBaseline.avgQualityScore;
    const tokenRatio = data.totalTokens / claudeBaseline.totalTokens;

    return {
      provider,
      qualityPercent: qualityRatio * 100,
      tokenPercent: tokenRatio * 100,
      claimValid: qualityRatio >= 0.95 && tokenRatio <= 0.20,
      qualityPerToken: qualityRatio / tokenRatio  // Higher is better
    };
  }
}
```

## Sample Output

```
Model Quality Benchmark Report
==============================
Date: 2026-01-17
Tasks: 4 (code-review, bug-fix, test-writing, refactoring)

Provider Summary
────────────────────────────────────────────────────────────────────
Provider          Tokens    Cost      Quality   vs Claude   Verdict
────────────────────────────────────────────────────────────────────
Claude            10,240    $0.15     100%      baseline    -
OpenRouter/DS     2,180     $0.006    96.2%     21% tokens  ✅ CLAIM VALID
Ollama/Qwen       1,890     $0.00     94.8%     18% tokens  ✅ CLAIM VALID
────────────────────────────────────────────────────────────────────

Claim Validation: ✅ PASSED
- OpenRouter: 96.2% quality at 21% tokens (4.6x efficiency)
- Ollama: 94.8% quality at 18% tokens (5.3x efficiency)

Recommendation: Use Ollama/qwen2.5-coder for cost-free local execution
with 94.8% of Claude quality.
```

## Dependencies

- Ollama running locally with qwen2.5-coder:7b
- OpenRouter API key (optional, for cloud comparison)
- Claude native access (baseline via user's Claude Code subscription)

## Last Updated: 2026-01-17 by /oss:plan
