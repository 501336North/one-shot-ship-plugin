# TDD Implementation Plan: Full Model Quality Comparison Loop

Compare Claude vs Ollama quality using Claude Code as both baseline generator AND judge.

## Overview

**Feature:** Model Quality Comparison Loop
**Goal:** Validate "95% quality at 25% tokens" claim with 12 benchmark tasks
**Status:** Planning

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Comparison Loop Flow                             │
│                                                                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐      │
│  │ Phase 1         │    │ Phase 2         │    │ Phase 3         │      │
│  │ TASK REGISTRY   │───▶│ RUN COMPARISON  │───▶│ GENERATE        │      │
│  │                 │    │                 │    │ VERDICT         │      │
│  │ • Define 12     │    │ • Claude base   │    │                 │      │
│  │   tasks         │    │ • Ollama call   │    │ • Score each    │      │
│  │ • Code snippets │    │ • Store results │    │ • Calculate %   │      │
│  │ • Prompts       │    │                 │    │ • PASS/FAIL     │      │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Task Registry (2 tasks, ~6 tests)

Define the 12 benchmark tasks with code snippets and prompts.

### Task 1.1: Create Task Registry
**Tests:** 3
```typescript
// test/services/benchmark/comparison-tasks.test.ts
describe('Comparison Task Registry', () => {
  it('should define 12 tasks across 4 categories');
  it('should include code snippet and prompt for each task');
  it('should categorize tasks as code-review, bug-fix, test-writing, refactoring');
});
```

**Implementation:**
- Create `src/services/benchmark/comparison-tasks.ts`
- Define 12 tasks with: id, name, category, codeSnippet, prompt
- Export as `COMPARISON_TASKS` array

### Task 1.2: Task Validation
**Tests:** 3
```typescript
describe('Task Validation', () => {
  it('should validate task has required fields');
  it('should have 3 tasks per category');
  it('should have unique task IDs');
});
```

---

## Phase 2: Comparison Runner (3 tasks, ~9 tests)

Execute the comparison loop: Claude baseline → Ollama → Judge.

### Task 2.1: Baseline Generator (Claude)
**Tests:** 3
```typescript
// test/services/benchmark/baseline-generator.test.ts
describe('Baseline Generator', () => {
  it('should generate Claude response for each task');
  it('should estimate token count from response length');
  it('should store baseline with task ID, response, and tokens');
});
```

**Implementation:**
- For this conversation, Claude (me) will generate responses inline
- Store in `baseline_responses.json`
- Token estimate: `response.length / 4`

### Task 2.2: Challenger Runner (Ollama)
**Tests:** 3
```typescript
// test/services/benchmark/challenger-runner.test.ts
describe('Challenger Runner', () => {
  it('should call Ollama API with task prompt');
  it('should capture response and actual token counts');
  it('should handle Ollama errors gracefully');
});
```

**Implementation:**
- Use existing OllamaIntegration
- Store in `challenger_responses.json`
- Capture `prompt_eval_count` + `eval_count`

### Task 2.3: Comparison Executor
**Tests:** 3
```typescript
// test/services/benchmark/comparison-executor.test.ts
describe('Comparison Executor', () => {
  it('should run all 12 tasks through baseline and challenger');
  it('should pair baseline and challenger responses by task ID');
  it('should calculate token ratio for each task');
});
```

---

## Phase 3: Quality Judge (2 tasks, ~6 tests)

Claude judges Ollama output vs baseline.

### Task 3.1: Scoring System
**Tests:** 3
```typescript
// test/services/benchmark/quality-judge.test.ts
describe('Quality Judge', () => {
  it('should score on 4 dimensions (correctness, completeness, explanation, code)');
  it('should weight scores (40/30/15/15)');
  it('should return score 0-100');
});
```

**Implementation:**
- Claude (me) evaluates each Ollama response
- Score: Correctness (40%), Completeness (30%), Explanation (15%), Code Quality (15%)
- Weighted average calculation

### Task 3.2: Judge Executor
**Tests:** 3
```typescript
describe('Judge Executor', () => {
  it('should judge all 12 task pairs');
  it('should store individual scores and reasoning');
  it('should calculate average quality score');
});
```

---

## Phase 4: Verdict Generator (2 tasks, ~6 tests)

Calculate final verdict and generate report.

### Task 4.1: Claim Validator
**Tests:** 3
```typescript
// test/services/benchmark/claim-validator.test.ts
describe('Claim Validator', () => {
  it('should calculate average quality percentage');
  it('should calculate average token ratio');
  it('should return VALIDATED if quality >= 95% AND tokens <= 25%');
});
```

### Task 4.2: Report Generator
**Tests:** 3
```typescript
describe('Report Generator', () => {
  it('should generate markdown report with task breakdown');
  it('should include per-task scores and token counts');
  it('should show final PASS/FAIL verdict');
});
```

---

## Phase 5: CLI Integration (1 task, ~3 tests)

Create CLI command to run the full comparison.

### Task 5.1: Comparison CLI
**Tests:** 3
```typescript
// test/cli/run-comparison.test.ts
describe('Run Comparison CLI', () => {
  it('should execute full comparison loop');
  it('should output progress for each step');
  it('should save report to ~/.oss/benchmarks/');
});
```

**Implementation:**
- Create `src/cli/run-comparison.ts`
- Usage: `npx tsx src/cli/run-comparison.ts`

---

## Summary

| Phase | Tasks | Estimated Tests |
|-------|-------|-----------------|
| Phase 1: Task Registry | 2 | 6 |
| Phase 2: Comparison Runner | 3 | 9 |
| Phase 3: Quality Judge | 2 | 6 |
| Phase 4: Verdict Generator | 2 | 6 |
| Phase 5: CLI Integration | 1 | 3 |
| **Total** | **10** | **~30** |

## Files to Create

**New Files:**
- `src/services/benchmark/comparison-tasks.ts` - 12 task definitions
- `src/services/benchmark/baseline-generator.ts` - Claude baseline (inline)
- `src/services/benchmark/challenger-runner.ts` - Ollama runner
- `src/services/benchmark/comparison-executor.ts` - Orchestrator
- `src/services/benchmark/quality-judge.ts` - Scoring logic
- `src/services/benchmark/verdict-generator.ts` - Final verdict
- `src/cli/run-comparison.ts` - CLI command
- Tests for each component

## Execution

After build completes:
```bash
# Run full comparison
npx tsx src/cli/run-comparison.ts

# Output saved to
~/.oss/benchmarks/comparison-{timestamp}.md
```

## Special Note: Claude as Baseline & Judge

Since we're using Claude Code (this conversation) as both baseline and judge:
1. **Baseline**: I will generate responses for each task inline during build
2. **Judge**: I will evaluate Ollama responses vs my baseline inline
3. **No external API key needed**

This is implemented through the conversation itself, not through API calls.

## Success Criteria

| Metric | Target | Validation |
|--------|--------|------------|
| Quality Score | ≥ 95% | Average across 12 tasks |
| Token Ratio | ≤ 25% | Ollama tokens / Claude tokens |
| Verdict | CLAIM_VALIDATED | Both conditions met |

## Last Updated: 2026-01-17 by /oss:plan
