# Testing Strategy: Perfect Logging System

## Test Categories

### 1. Unit Tests (Shell)
Test each oss-log.sh action in isolation:
```bash
# Test hook action
./hooks/oss-log.sh hook SessionStart START
grep "hook.*SessionStart.*START" ~/.oss/logs/current-session/session.log

# Test skill action
./hooks/oss-log.sh skill create-dev-docs START "feature=auth"
grep "skill.*create-dev-docs.*START" ~/.oss/logs/current-session/session.log

# Test milestone action
./hooks/oss-log.sh milestone plan archive_check "No features to archive"
grep "MILESTONE.*archive_check" ~/.oss/logs/current-session/plan.log
```

### 2. Integration Tests
Test logging across component boundaries:
```bash
# Test: Full session lifecycle logs correctly
# 1. Start session
# 2. Run /oss:plan
# 3. End session
# Verify: All events logged in order
```

### 3. End-to-End Tests
Test supervisor can reconstruct session from logs:
```bash
# Run: Complete ideate → plan → build → ship workflow
# Verify: Supervisor can answer all 7 questions from logs
```

## Test Files

### watcher/test/logger/oss-log.test.ts
```typescript
describe('oss-log.sh', () => {
  describe('hook action', () => {
    it('logs hook start to session log');
    it('logs hook complete to session log');
    it('logs hook failed to session log');
  });

  describe('skill action', () => {
    it('logs skill start with args');
    it('logs skill complete with result');
  });

  describe('milestone action', () => {
    it('logs milestone to command log');
    it('logs milestone to session log');
  });
});
```

### watcher/test/integration/logging-flow.test.ts
```typescript
describe('Logging Flow', () => {
  it('captures full command lifecycle');
  it('captures agent delegation cycle');
  it('captures error and recovery');
});
```

## Acceptance Criteria

1. **Completeness**: Every execution path has logging
2. **Consistency**: Same format across all components
3. **Traceability**: Can follow execution thread through logs
4. **Queryability**: Supervisor can grep for specific events
5. **Performance**: Logging doesn't impact execution time >1%

## Test Results

| Test Suite | Status | Pass | Fail | Skip |
|------------|--------|------|------|------|
| oss-log.sh unit | Pending | - | - | - |
| hook logging | Pending | - | - | - |
| command logging | Pending | - | - | - |
| skill logging | Pending | - | - | - |
| daemon logging | Pending | - | - | - |
| integration | Pending | - | - | - |

*Last Updated: 2025-12-25*
