# Status Line UX Polish - TDD Implementation Plan

## Overview

**Goal:** Fix "Saved unknown" issue and ensure status line only displays valid, valuable information.

**Approach:** London TDD (Outside-In) - Start at the boundary (notification-copy.ts) and work inward.

**Estimated Tasks:** 6 tasks across 2 phases

---

## Phase 1: Notification Copy Validation Layer

The core fix - add validation in notification-copy.ts to handle "unknown" values gracefully.

### Task 1.1: Add test for context_restored with valid saveDate
**TDD Phase:** RED → GREEN → REFACTOR

**File:** `watcher/test/services/notification-copy.test.ts`

```typescript
/**
 * @behavior context_restored with valid saveDate shows relative time
 * @acceptance-criteria AC-002
 */
test('context_restored with valid saveDate shows "Saved X ago"', () => {
  const copy = service.getSessionCopy('context_restored', {
    saveDate: '5m ago',
    branch: 'main',
    uncommitted: 0
  });
  expect(copy.message).toBe('Saved 5m ago');
  expect(copy.message).not.toContain('unknown');
});
```

**Expected:** Test fails (current behavior already passes, but we're establishing baseline)

---

### Task 1.2: Add test for context_restored with "unknown" saveDate
**TDD Phase:** RED → GREEN → REFACTOR

**File:** `watcher/test/services/notification-copy.test.ts`

```typescript
/**
 * @behavior context_restored with unknown saveDate shows graceful fallback
 * @acceptance-criteria AC-003
 */
test('context_restored with unknown saveDate shows "Context loaded" without date', () => {
  const copy = service.getSessionCopy('context_restored', {
    saveDate: 'unknown',
    branch: 'main',
    uncommitted: 0
  });
  expect(copy.message).toBe('Context loaded');
  expect(copy.message).not.toContain('unknown');
  expect(copy.message).not.toContain('Saved');
});
```

**Expected:** Test FAILS (current returns "Saved unknown")

**GREEN Implementation:**
In `notification-copy.ts`, modify `getSessionCopy()` to check for invalid saveDate:

```typescript
// Before interpolation, validate saveDate
if (event === 'context_restored') {
  const saveDate = context.saveDate;
  if (!saveDate || saveDate === 'unknown' || saveDate === '') {
    return { title: 'Context Loaded', message: 'Context loaded' };
  }
}
```

---

### Task 1.3: Add test for context_restored with empty saveDate
**TDD Phase:** RED → GREEN → REFACTOR

**File:** `watcher/test/services/notification-copy.test.ts`

```typescript
/**
 * @behavior context_restored with empty saveDate shows graceful fallback
 * @acceptance-criteria AC-003
 */
test('context_restored with empty saveDate shows "Context loaded"', () => {
  const copy = service.getSessionCopy('context_restored', {
    saveDate: '',
    branch: 'main',
    uncommitted: 0
  });
  expect(copy.message).toBe('Context loaded');
  expect(copy.message).not.toContain('Saved');
});
```

---

### Task 1.4: Add test for context_restored with missing saveDate
**TDD Phase:** RED → GREEN → REFACTOR

**File:** `watcher/test/services/notification-copy.test.ts`

```typescript
/**
 * @behavior context_restored with missing saveDate shows graceful fallback
 * @acceptance-criteria AC-003
 */
test('context_restored with missing saveDate shows "Context loaded"', () => {
  const copy = service.getSessionCopy('context_restored', {
    branch: 'main',
    uncommitted: 0
    // saveDate intentionally omitted
  });
  expect(copy.message).toBe('Context loaded');
});
```

---

## Phase 2: Shell Script Hardening

Secondary fix - prevent "unknown" from being passed in the first place.

### Task 2.1: Update oss-session-start.sh to skip date on parse failure
**TDD Phase:** Integration test

**File:** `watcher/test/hooks/oss-session-start.test.ts` (new)

```typescript
/**
 * @behavior Session start with invalid context date doesn't pass "unknown"
 * @acceptance-criteria AC-003
 */
test('session start with malformed date omits saveDate from context', async () => {
  // Create context file with invalid date
  await fs.writeFile(contextFile, '## Context\n_Saved: invalid-date_\n');

  // Run session start hook
  const { stdout } = await execAsync(`${hookPath}/oss-session-start.sh`);

  // Verify notification doesn't contain "unknown"
  const state = JSON.parse(await fs.readFile(workflowState, 'utf8'));
  expect(state.notification.message).not.toContain('unknown');
});
```

**GREEN Implementation:**
In `oss-session-start.sh`, modify the notification call:

```bash
# Only include saveDate if it's valid (not "unknown")
if [[ "$SAVE_DATE" != "unknown" && -n "$SAVE_DATE" ]]; then
    CONTEXT_JSON="{\"project\": \"$PROJECT_NAME\", \"branch\": \"${BRANCH:-unknown}\", \"saveDate\": \"${SAVE_DATE}\", \"uncommitted\": $UNCOMMITTED_COUNT}"
else
    # Omit saveDate entirely - let notification-copy.ts handle gracefully
    CONTEXT_JSON="{\"project\": \"$PROJECT_NAME\", \"branch\": \"${BRANCH:-unknown}\", \"uncommitted\": $UNCOMMITTED_COUNT}"
fi
"$NOTIFY_SCRIPT" --session context_restored "$CONTEXT_JSON"
```

---

### Task 2.2: Update branch fallback to omit rather than "unknown"
**TDD Phase:** RED → GREEN → REFACTOR

**File:** `watcher/test/hooks/oss-session-start.test.ts`

```typescript
/**
 * @behavior Session start without git repo omits branch instead of "unknown"
 * @acceptance-criteria AC-001
 */
test('session start outside git repo omits branch from context', async () => {
  // Run in non-git directory
  const { stdout } = await execAsync(`${hookPath}/oss-session-start.sh`, {
    cwd: '/tmp'
  });

  // Verify no "unknown" in notification
  const state = JSON.parse(await fs.readFile(workflowState, 'utf8'));
  expect(state.notification.message).not.toContain('unknown');
});
```

**GREEN Implementation:**
In `oss-session-start.sh`:

```bash
# Only include branch if we got one
BRANCH=$(git branch --show-current 2>/dev/null)
if [[ -n "$BRANCH" ]]; then
    BRANCH_JSON="\"branch\": \"$BRANCH\","
else
    BRANCH_JSON=""  # Omit entirely
fi
```

---

## Execution Order

```
Phase 1 (Core Fix - notification-copy.ts)
├── Task 1.1: Baseline test for valid saveDate ✓
├── Task 1.2: Test + fix for "unknown" saveDate ← KEY FIX
├── Task 1.3: Test for empty saveDate
└── Task 1.4: Test for missing saveDate

Phase 2 (Shell Hardening - oss-session-start.sh)
├── Task 2.1: Test + fix for date parse failure
└── Task 2.2: Test + fix for missing branch
```

---

## Success Criteria

After completing all tasks:
1. `npm test` passes 100%
2. "unknown" never appears in status line under any scenario
3. Users see meaningful messages at all times

---

## Files Modified

| File | Changes |
|------|---------|
| `watcher/src/services/notification-copy.ts` | Add validation for "unknown" values |
| `watcher/test/services/notification-copy.test.ts` | Add 4 new tests |
| `hooks/oss-session-start.sh` | Omit invalid values instead of passing "unknown" |
| `watcher/test/hooks/oss-session-start.test.ts` | New integration test file |

---

## Next Command

After plan approval: `/oss:build`
