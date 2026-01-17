# Testing Strategy: Spec Sync Daemon

## Test Files to Create

| File | Phase | Test Count |
|------|-------|------------|
| `test/services/spec-reconciler/types.test.ts` | 1 | 4 |
| `test/services/spec-reconciler/parser.test.ts` | 1 | 7 |
| `test/services/spec-reconciler/file-matcher.test.ts` | 1 | 4 |
| `test/monitors/spec-monitor.test.ts` | 2 | 16 |
| `test/services/spec-reconciler/reconciler.test.ts` | 3 | 8 |
| `test/services/spec-reconciler/auto-fixer.test.ts` | 3 | 4 |
| `test/services/spec-metrics.test.ts` | 4 | 10 |
| `test/services/spec-reconciler/diff-generator.test.ts` | 5 | 8 |
| `test/services/build-preflight.test.ts` | 6 | 8 |
| `test/supervisor/watcher-supervisor-spec.test.ts` | 7 | 2 |
| `test/services/healthcheck.test.ts` (additions) | 7 | 4 |

**Total: 74 tests**

## Testing Approach

### London TDD (Outside-In)

1. **Mock all collaborators**
   - QueueManager
   - File system operations (use virtual fs)
   - WorkflowLogger

2. **Verify behavior through mock expectations**
   - `expect(mockQueueManager.addTask).toHaveBeenCalledWith(...)`
   - `expect(mockFs.writeFile).toHaveBeenCalledWith(...)`

3. **Test files should focus on behavior**
   - What user/system behavior does this verify?
   - Not implementation details

## Mock Strategy

| Dependency | Mock Type | Library |
|------------|-----------|---------|
| QueueManager | Mock | vi.fn() |
| File system | Stub | memfs or vi.mock('fs/promises') |
| WorkflowLogger | Mock | vi.fn() |
| Glob operations | Stub | Return fixed file lists |

## Test Fixtures

Create `test/fixtures/spec-sync/`:
- `valid-design.md` - Complete spec with all markers
- `partial-design.md` - Missing some markers
- `malformed-design.md` - Broken markers
- `empty-design.md` - No content

## Coverage Requirements

- Minimum 90% line coverage
- 100% branch coverage for critical paths (drift detection, auto-fix)
- All error paths tested

## Test Results

| Phase | Pass | Fail | Skip | Coverage |
|-------|------|------|------|----------|
| 1 | - | - | - | - |
| 2 | - | - | - | - |
| 3 | - | - | - | - |
| 4 | - | - | - | - |
| 5 | - | - | - | - |
| 6 | - | - | - | - |
| 7 | - | - | - | - |

## Last Updated: 2026-01-16 20:45 by /oss:plan
