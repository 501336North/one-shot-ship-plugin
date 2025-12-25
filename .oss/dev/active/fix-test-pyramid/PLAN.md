# TDD Plan: Fix Inverted Testing Pyramid

## Problem Statement

The test suite has an **inverted testing pyramid**:
- **Current**: Many E2E tests (shell script execution via `execSync`)
- **Target**: 80% unit tests, 15% integration, 5% E2E (CI-only)

### Evidence
- 142 `execSync` calls across 26 test files
- 17 hook tests that spawn bash subprocesses
- Tests fight over shared global state (`~/.oss/current-project`)
- Tests are slow (process spawning overhead)
- Laptop becomes unbearably slow during test runs

## Solution Architecture

### 1. ShellExecutor Interface
Abstract shell script execution behind an interface that can be mocked in unit tests.

### 2. Bats for Bash Testing
Move pure bash logic tests to bats (Bash Automated Testing System) - the right tool for bash testing.

### 3. Unit Tests with Mocks
Convert E2E tests to fast unit tests that mock the ShellExecutor.

### 4. CI-Only E2E Tests
Keep a small suite of E2E tests that run only in CI to validate real shell execution.

---

## Phase 1: Create ShellExecutor Interface (Foundation)

### Task 1.1: Define ShellExecutor Interface
**Test First**: Write failing test for ShellExecutor interface
```typescript
// watcher/src/interfaces/shell-executor.ts
interface ShellExecutorResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ShellExecutor {
  execute(script: string, args: string[], options?: ShellOptions): Promise<ShellExecutorResult>;
}
```

### Task 1.2: Implement RealShellExecutor
**Test First**: Write failing test for real implementation
- Wraps `execSync` / `exec`
- Used in production code

### Task 1.3: Create MockShellExecutor
**Test First**: Write failing test for mock implementation
- Returns configurable responses
- Records calls for verification
- No actual process spawning

---

## Phase 2: Refactor oss-log.sh Tests (Pilot)

### Task 2.1: Extract Shell Logic to TypeScript Wrapper
**Test First**: Create wrapper that uses ShellExecutor
```typescript
// watcher/src/shell/oss-log-wrapper.ts
class OssLogWrapper {
  constructor(private executor: ShellExecutor) {}

  async logHook(hookName: string, event: string, reason?: string): Promise<void> {
    await this.executor.execute('hooks/oss-log.sh', ['hook', hookName, event, reason].filter(Boolean));
  }
}
```

### Task 2.2: Convert oss-log-hook-action.test.ts to Unit Tests
**Test First**: Write unit tests using MockShellExecutor
- Remove `execSync` calls
- Mock file system for log verification
- Test behavior, not shell output

### Task 2.3: Move Bash Syntax Tests to Bats
Create `hooks/test/oss-log.bats` for:
- Argument parsing
- Exit codes
- Usage messages

---

## Phase 3: Refactor Remaining Hook Tests

### Task 3.1: oss-notify.sh Tests
- Extract to OssNotifyWrapper
- Convert to unit tests
- Move bash tests to bats

### Task 3.2: oss-statusline.sh Tests
- Extract to OssStatuslineWrapper
- Convert to unit tests
- Move bash tests to bats

### Task 3.3: oss-session-*.sh Tests
- Extract to OssSessionWrapper
- Convert to unit tests
- Move bash tests to bats

---

## Phase 4: Refactor CLI Tests

### Task 4.1: update-workflow-state.ts Tests
- Already TypeScript - just need to mock dependencies
- Remove `execSync` calls to CLI
- Test service methods directly

### Task 4.2: health-check.ts Tests
- Mock external dependencies
- Test logic, not process spawning

---

## Phase 5: E2E Test Isolation

### Task 5.1: Create E2E Test Directory
```
watcher/test/e2e/  # Separate from unit tests
├── smoke.test.ts  # Critical path validation
└── integration-smoke.test.ts
```

### Task 5.2: Configure CI-Only Execution
Update vitest.config.ts:
```typescript
export default defineConfig({
  test: {
    include: process.env.CI
      ? ['test/**/*.test.ts']  // CI runs all
      : ['test/**/*.test.ts', '!test/e2e/**'],  // Local skips E2E
  }
});
```

### Task 5.3: Migrate Heavy E2E Tests
Move tests that MUST spawn real processes to `test/e2e/`

---

## Acceptance Criteria

1. **Unit test ratio**: >= 80% of tests are unit tests (no process spawning)
2. **Speed**: Local test suite runs in < 30 seconds
3. **Isolation**: Tests don't share global state
4. **100% pass rate**: All tests pass consistently
5. **No flakiness**: Zero flaky tests
6. **CI coverage**: E2E tests run in CI to validate real behavior

---

## Task Checklist

### Phase 1: ShellExecutor Interface
- [ ] Task 1.1: Define ShellExecutor interface (RED → GREEN → REFACTOR)
- [ ] Task 1.2: Implement RealShellExecutor (RED → GREEN → REFACTOR)
- [ ] Task 1.3: Create MockShellExecutor (RED → GREEN → REFACTOR)

### Phase 2: Pilot Refactor (oss-log.sh)
- [ ] Task 2.1: Create OssLogWrapper (RED → GREEN → REFACTOR)
- [ ] Task 2.2: Convert hook tests to unit tests (RED → GREEN → REFACTOR)
- [ ] Task 2.3: Create bats tests for bash syntax

### Phase 3: Remaining Hooks
- [ ] Task 3.1: OssNotifyWrapper + unit tests
- [ ] Task 3.2: OssStatuslineWrapper + unit tests
- [ ] Task 3.3: OssSessionWrapper + unit tests

### Phase 4: CLI Tests
- [ ] Task 4.1: Refactor update-workflow-state tests
- [ ] Task 4.2: Refactor health-check tests

### Phase 5: E2E Isolation
- [ ] Task 5.1: Create e2e directory
- [ ] Task 5.2: Configure CI-only execution
- [ ] Task 5.3: Migrate heavy E2E tests

---

## Dependencies

- `bats-core`: Bash testing framework (brew install bats-core)
- No other new dependencies required

---

## Risk Mitigation

1. **Gradual migration**: Keep existing tests passing while adding new ones
2. **Feature parity**: Unit tests must cover same behavior as E2E tests
3. **CI safety net**: E2E tests in CI catch any mocking gaps

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| execSync calls in tests | 142 | < 20 |
| Test run time (local) | ~60s | < 30s |
| Unit test ratio | ~30% | > 80% |
| Flaky tests | Occasional | Zero |
| Process spawning | Every test | CI only |

---

*Plan created: 2025-12-25*
*Methodology: London TDD (Outside-In)*
