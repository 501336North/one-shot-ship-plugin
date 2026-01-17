# Design: Full Model Quality Comparison Loop

## Overview

Compare Claude vs Ollama quality using **Claude Code as both baseline generator AND judge**.

**Claim to Validate:** "95% of the quality for 20-25% of the tokens"

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Claude Code Comparison Loop                           │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     TASK REGISTRY (12 tasks)                     │   │
│  │                                                                   │   │
│  │  Code Review (3)     Bug Fix (3)     Test Writing (3)   Refactor (3)│
│  │  ─────────────────────────────────────────────────────────────── │   │
│  │  • Off-by-one       • Null check    • Unit test       • Extract   │   │
│  │  • Type coercion    • Race cond     • Integration     • Rename    │   │
│  │  • Memory leak      • SQL inject    • Edge cases      • Simplify  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    STEP 1: BASELINE (Claude)                     │   │
│  │                                                                   │   │
│  │  For each task:                                                  │   │
│  │    1. Claude (me) generates response                             │   │
│  │    2. Store as baseline output                                   │   │
│  │    3. Estimate token count (chars / 4)                           │   │
│  │                                                                   │   │
│  │  Output: baseline_responses.json                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    STEP 2: CHALLENGER (Ollama)                   │   │
│  │                                                                   │   │
│  │  For each task:                                                  │   │
│  │    1. Call Ollama API with same prompt                           │   │
│  │    2. Store response                                             │   │
│  │    3. Capture actual token count (prompt_eval + eval)            │   │
│  │                                                                   │   │
│  │  Output: challenger_responses.json                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    STEP 3: JUDGE (Claude)                        │   │
│  │                                                                   │   │
│  │  For each task:                                                  │   │
│  │    1. Claude (me) compares Ollama vs baseline                    │   │
│  │    2. Score on 4 dimensions (0-100 each):                        │   │
│  │       • Correctness (right answer?)                              │   │
│  │       • Completeness (all cases?)                                │   │
│  │       • Explanation (clear reasoning?)                           │   │
│  │       • Code Quality (clean code?)                               │   │
│  │    3. Calculate weighted average (40/30/15/15)                   │   │
│  │                                                                   │   │
│  │  Output: evaluation_results.json                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    STEP 4: VERDICT                               │   │
│  │                                                                   │   │
│  │  Calculate:                                                      │   │
│  │    • Average Quality Score across all tasks                      │   │
│  │    • Token Ratio: Ollama tokens / Claude tokens                  │   │
│  │                                                                   │   │
│  │  Verdict:                                                        │   │
│  │    CLAIM_VALIDATED if:                                           │   │
│  │      Quality >= 95% AND Token Ratio <= 25%                       │   │
│  │                                                                   │   │
│  │  Output: VALIDATION_REPORT.md                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Task Definitions (12 Tasks)

### Category 1: Code Review (3 tasks)

**Task 1.1: Off-by-one Error**
```javascript
// Prompt: Review this code and identify bugs
function processItems(items) {
  for (let i = 0; i <= items.length; i++) {
    console.log(items[i].name);
  }
}
```

**Task 1.2: Type Coercion Bug**
```javascript
// Prompt: Review this code and identify bugs
function checkValue(val) {
  if (val == null) {
    return 'empty';
  }
  return val + 1;
}
checkValue('5'); // What does this return?
```

**Task 1.3: Memory Leak**
```javascript
// Prompt: Review this code and identify bugs
const cache = {};
function processRequest(id, data) {
  cache[id] = data;
  return cache[id];
}
// Called millions of times with unique IDs
```

### Category 2: Bug Fix (3 tasks)

**Task 2.1: Null Check Fix**
```javascript
// Prompt: Fix the null reference bug
function getUserName(user) {
  return user.profile.name.toUpperCase();
}
```

**Task 2.2: Race Condition Fix**
```javascript
// Prompt: Fix the race condition
let counter = 0;
async function increment() {
  const current = counter;
  await delay(10);
  counter = current + 1;
}
```

**Task 2.3: SQL Injection Fix**
```javascript
// Prompt: Fix the SQL injection vulnerability
function findUser(username) {
  const query = `SELECT * FROM users WHERE name = '${username}'`;
  return db.execute(query);
}
```

### Category 3: Test Writing (3 tasks)

**Task 3.1: Unit Test**
```javascript
// Prompt: Write unit tests for this function
function calculateDiscount(price, percentage) {
  if (percentage < 0 || percentage > 100) {
    throw new Error('Invalid percentage');
  }
  return price * (1 - percentage / 100);
}
```

**Task 3.2: Integration Test**
```javascript
// Prompt: Write integration tests
async function createOrder(userId, items) {
  const user = await UserService.get(userId);
  const order = await OrderService.create(user, items);
  await EmailService.sendConfirmation(user.email, order);
  return order;
}
```

**Task 3.3: Edge Case Tests**
```javascript
// Prompt: Write tests for edge cases
function parseCSV(input) {
  return input.split('\n').map(row => row.split(','));
}
```

### Category 4: Refactoring (3 tasks)

**Task 4.1: Extract Function**
```javascript
// Prompt: Refactor by extracting functions
function processOrder(order) {
  let total = 0;
  for (const item of order.items) {
    total += item.price * item.quantity;
  }
  if (order.coupon) {
    total = total * (1 - order.coupon.discount);
  }
  if (total > 100) {
    total = total * 0.95; // bulk discount
  }
  return { ...order, total, tax: total * 0.08 };
}
```

**Task 4.2: Rename Variables**
```javascript
// Prompt: Refactor with better variable names
function calc(a, b, c) {
  const x = a * b;
  const y = x - c;
  const z = y > 0 ? y : 0;
  return z;
}
```

**Task 4.3: Simplify Logic**
```javascript
// Prompt: Simplify this code
function getStatus(user) {
  if (user.isActive === true) {
    if (user.isPremium === true) {
      return 'premium';
    } else {
      return 'active';
    }
  } else {
    return 'inactive';
  }
}
```

## Scoring System

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Correctness | 40% | Identified/fixed the right issue |
| Completeness | 30% | Covered all aspects/edge cases |
| Explanation | 15% | Clear, helpful reasoning |
| Code Quality | 15% | Clean, idiomatic code |

**Final Score:** Weighted average of all dimensions

## Token Counting

| Provider | Method |
|----------|--------|
| Claude (baseline) | `response.length / 4` (approximate) |
| Ollama | `prompt_eval_count + eval_count` (actual) |

## Success Criteria

**Claim is VALIDATED if:**
- Average Quality Score ≥ 95%
- Average Token Ratio ≤ 25%

## Output Files

```
.oss/dev/active/model-comparison-loop/
├── DESIGN.md                    # This file
├── PLAN.md                      # TDD implementation plan
├── PROGRESS.md                  # Task completion tracking
├── baseline_responses.json      # Claude's responses
├── challenger_responses.json    # Ollama's responses
├── evaluation_results.json      # Scoring results
└── VALIDATION_REPORT.md         # Final verdict
```

## Implementation Approach

No new agents or prompts needed - we use:
1. **Claude Code (this conversation)** - Generate baselines and judge
2. **Existing Ollama infrastructure** - Call local Ollama API
3. **Existing benchmark types** - BenchmarkTask, BenchmarkResult

## Last Updated: 2026-01-17 by /oss:ideate
