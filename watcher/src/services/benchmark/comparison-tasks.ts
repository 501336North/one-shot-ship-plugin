/**
 * @file Comparison Task Registry
 * @description 12 structured tasks for model comparison across 4 categories
 */

/**
 * Categories for comparison tasks
 */
export type ComparisonTaskCategory = 'code-review' | 'bug-fix' | 'test-writing' | 'refactoring';

/**
 * A comparison task with code snippet and prompt
 */
export interface ComparisonTask {
  /** Unique identifier for the task */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category of the task */
  category: ComparisonTaskCategory;
  /** Code snippet to evaluate */
  codeSnippet: string;
  /** Prompt for the model */
  prompt: string;
}

/**
 * Validates that a comparison task has all required fields
 */
export function validateComparisonTask(task: ComparisonTask): boolean {
  if (!task.id || task.id.length === 0) return false;
  if (!task.name || task.name.length === 0) return false;
  if (!task.codeSnippet || task.codeSnippet.length === 0) return false;
  if (!task.prompt || task.prompt.length === 0) return false;
  if (!['code-review', 'bug-fix', 'test-writing', 'refactoring'].includes(task.category)) {
    return false;
  }
  return true;
}

// ============================================================================
// CODE REVIEW TASKS (3)
// ============================================================================

/**
 * Code Review Task 1: Off-by-one error in loop
 */
const CODE_REVIEW_OFF_BY_ONE: ComparisonTask = {
  id: 'cr-off-by-one',
  name: 'Off-by-one loop error',
  category: 'code-review',
  codeSnippet: `function processItems(items) {
  const results = [];
  for (let i = 0; i <= items.length; i++) {
    results.push(items[i].toUpperCase());
  }
  return results;
}`,
  prompt: 'Review this code and identify any bugs or issues.',
};

/**
 * Code Review Task 2: Type coercion issues
 */
const CODE_REVIEW_TYPE_COERCION: ComparisonTask = {
  id: 'cr-type-coercion',
  name: 'Type coercion bugs',
  category: 'code-review',
  codeSnippet: `function addOne(val) {
  if (val == null) {
    return 0;
  }
  return val + 1;
}
// Called with: addOne("5")`,
  prompt: 'Review this code and identify any type-related issues.',
};

/**
 * Code Review Task 3: Memory leak with unbounded cache
 */
const CODE_REVIEW_MEMORY_LEAK: ComparisonTask = {
  id: 'cr-memory-leak',
  name: 'Memory leak in cache',
  category: 'code-review',
  codeSnippet: `const cache = {};

function fetchData(userId) {
  if (!cache[userId]) {
    cache[userId] = {
      data: loadFromDatabase(userId),
      timestamp: Date.now()
    };
  }
  return cache[userId].data;
}`,
  prompt: 'Review this caching code and identify any potential issues.',
};

// ============================================================================
// BUG FIX TASKS (3)
// ============================================================================

/**
 * Bug Fix Task 1: Null check for nested property
 */
const BUG_FIX_NULL_CHECK: ComparisonTask = {
  id: 'bf-null-check',
  name: 'Missing null check',
  category: 'bug-fix',
  codeSnippet: `function getDisplayName(user) {
  return user.profile.name.toUpperCase();
}
// Error: Cannot read property 'name' of undefined`,
  prompt: 'Fix the bug in this code that causes the error shown.',
};

/**
 * Bug Fix Task 2: Race condition in async counter
 */
const BUG_FIX_RACE_CONDITION: ComparisonTask = {
  id: 'bf-race-condition',
  name: 'Race condition in counter',
  category: 'bug-fix',
  codeSnippet: `let counter = 0;

async function incrementCounter() {
  const current = counter;
  await saveToDatabase(current + 1);
  counter = current + 1;
}
// Called concurrently: Promise.all([incrementCounter(), incrementCounter()])
// Expected: counter = 2, Actual: counter = 1`,
  prompt: 'Fix the race condition bug in this async counter code.',
};

/**
 * Bug Fix Task 3: SQL injection vulnerability
 */
const BUG_FIX_SQL_INJECTION: ComparisonTask = {
  id: 'bf-sql-injection',
  name: 'SQL injection vulnerability',
  category: 'bug-fix',
  codeSnippet: `function findUser(username) {
  const query = \`SELECT * FROM users WHERE username = '\${username}'\`;
  return database.execute(query);
}
// Called with: findUser("admin' OR '1'='1")`,
  prompt: 'Fix the security vulnerability in this database query.',
};

// ============================================================================
// TEST WRITING TASKS (3)
// ============================================================================

/**
 * Test Writing Task 1: Unit test for calculateDiscount
 */
const TEST_WRITING_UNIT: ComparisonTask = {
  id: 'tw-unit-test',
  name: 'Unit test for discount calculator',
  category: 'test-writing',
  codeSnippet: `function calculateDiscount(price, discountPercent) {
  if (price <= 0 || discountPercent < 0 || discountPercent > 100) {
    throw new Error('Invalid input');
  }
  return price * (1 - discountPercent / 100);
}`,
  prompt: 'Write comprehensive unit tests for this discount calculator function.',
};

/**
 * Test Writing Task 2: Integration test for createOrder
 */
const TEST_WRITING_INTEGRATION: ComparisonTask = {
  id: 'tw-integration-test',
  name: 'Integration test for order service',
  category: 'test-writing',
  codeSnippet: `class OrderService {
  constructor(inventoryService, paymentService, notificationService) {
    this.inventory = inventoryService;
    this.payment = paymentService;
    this.notification = notificationService;
  }

  async createOrder(userId, items) {
    await this.inventory.reserveItems(items);
    const total = this.calculateTotal(items);
    await this.payment.charge(userId, total);
    await this.notification.sendConfirmation(userId);
    return { orderId: generateId(), items, total };
  }
}`,
  prompt: 'Write integration tests for this OrderService.createOrder method.',
};

/**
 * Test Writing Task 3: Edge case tests for parseCSV
 */
const TEST_WRITING_EDGE_CASES: ComparisonTask = {
  id: 'tw-edge-cases',
  name: 'Edge case tests for CSV parser',
  category: 'test-writing',
  codeSnippet: `function parseCSV(csvString) {
  if (!csvString) return [];
  return csvString.split('\\n').map(row => row.split(','));
}`,
  prompt: 'Write tests covering edge cases for this CSV parser function.',
};

// ============================================================================
// REFACTORING TASKS (3)
// ============================================================================

/**
 * Refactoring Task 1: Extract function from processOrder
 */
const REFACTOR_EXTRACT_FUNCTION: ComparisonTask = {
  id: 'rf-extract-function',
  name: 'Extract function from order processor',
  category: 'refactoring',
  codeSnippet: `function processOrder(order) {
  // Calculate subtotal
  let subtotal = 0;
  for (const item of order.items) {
    subtotal += item.price * item.quantity;
  }

  // Calculate tax
  const taxRate = order.state === 'CA' ? 0.0875 : 0.06;
  const tax = subtotal * taxRate;

  // Calculate shipping
  const weight = order.items.reduce((w, i) => w + i.weight * i.quantity, 0);
  const shipping = weight > 10 ? 15.99 : 5.99;

  return { subtotal, tax, shipping, total: subtotal + tax + shipping };
}`,
  prompt: 'Refactor this function to extract separate functions for each calculation.',
};

/**
 * Refactoring Task 2: Rename unclear variables
 */
const REFACTOR_RENAME_VARIABLES: ComparisonTask = {
  id: 'rf-rename-variables',
  name: 'Rename unclear variables',
  category: 'refactoring',
  codeSnippet: `function calc(a, b, c) {
  const x = a * b;
  const y = x * (1 - c / 100);
  const z = y > 1000 ? y * 0.95 : y;
  return z;
}
// This calculates final price with discount and bulk discount`,
  prompt: 'Refactor this code to use clear, descriptive variable names.',
};

/**
 * Refactoring Task 3: Simplify nested conditionals
 */
const REFACTOR_SIMPLIFY_LOGIC: ComparisonTask = {
  id: 'rf-simplify-logic',
  name: 'Simplify nested conditionals',
  category: 'refactoring',
  codeSnippet: `function getUserStatus(user) {
  if (user) {
    if (user.isActive) {
      if (user.subscription) {
        if (user.subscription.type === 'premium') {
          return 'premium';
        } else {
          return 'basic';
        }
      } else {
        return 'free';
      }
    } else {
      return 'inactive';
    }
  } else {
    return 'unknown';
  }
}`,
  prompt: 'Refactor this function to simplify the nested conditional logic.',
};

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * All 12 comparison tasks
 */
export const COMPARISON_TASKS: ComparisonTask[] = [
  // Code Review (3)
  CODE_REVIEW_OFF_BY_ONE,
  CODE_REVIEW_TYPE_COERCION,
  CODE_REVIEW_MEMORY_LEAK,
  // Bug Fix (3)
  BUG_FIX_NULL_CHECK,
  BUG_FIX_RACE_CONDITION,
  BUG_FIX_SQL_INJECTION,
  // Test Writing (3)
  TEST_WRITING_UNIT,
  TEST_WRITING_INTEGRATION,
  TEST_WRITING_EDGE_CASES,
  // Refactoring (3)
  REFACTOR_EXTRACT_FUNCTION,
  REFACTOR_RENAME_VARIABLES,
  REFACTOR_SIMPLIFY_LOGIC,
];
