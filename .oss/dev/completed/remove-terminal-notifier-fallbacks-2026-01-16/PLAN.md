# Plan: Remove terminal-notifier Fallbacks

## Overview

Remove `terminal-notifier` usage as a fallback mechanism. All notifications MUST go through the Claude Code status line, **EXCEPT** for:
- **Done** notification (oss-stop.sh) - Keep terminal-notifier
- **Ready** notification (session start) - Keep terminal-notifier

These are the ONLY two exceptions because they represent session boundaries where the status line may not be visible to the user.

## Current State Analysis

### Files with terminal-notifier fallbacks that MUST be removed:

| File | Line | Usage | Action |
|------|------|-------|--------|
| `watcher/src/index.ts` | 324-325 | Fallback in sendNotification() | REMOVE fallback, use status line |
| `watcher/src/queue/manager.ts` | 113-115 | Fallback in sendDebugNotification() | REMOVE fallback, use status line |
| `watcher/src/cli/health-check.ts` | 530-531 | Fallback in sendNotification() | REMOVE fallback, use status line |
| `watcher/src/intervention/generator.ts` | 140 | Comment reference | Update comment |

### Files where terminal-notifier is CORRECTLY used (KEEP):

| File | Usage | Why Keep |
|------|-------|----------|
| `hooks/oss-stop.sh` | "Done" notification | Session boundary - user needs audio/visual feedback after Claude exits |
| `hooks/oss-session-start.sh` | "Ready" notification (if exists) | Session boundary - user needs feedback before Claude is active |

## Architecture

### Before (Wrong)
```
Notification needed
    └── Try oss-notify.sh
        └── If fails → terminal-notifier (BAD - bypasses status line)
```

### After (Correct)
```
Notification needed
    └── ALWAYS use status line via oss-notify.sh or CLI
        └── If oss-notify.sh not found → use CLI directly
        └── NEVER fall back to terminal-notifier
```

---

## Phase 1: Update watcher/src/index.ts (RED → GREEN → REFACTOR)

### Task 1.1: Test sendNotification uses status line only

```typescript
/**
 * @behavior sendNotification uses status line, never terminal-notifier
 * @acceptance-criteria No terminal-notifier in sendNotification
 * @business-rule All runtime notifications use status line
 * @boundary watcher
 */
describe('WatcherSupervisor sendNotification', () => {
  it('should not call terminal-notifier directly', async () => {
    // GIVEN - No oss-notify.sh available
    vi.mocked(fs.existsSync).mockReturnValue(false);

    // WHEN - Sending notification
    // (Call private method via public interface that triggers it)

    // THEN - Should NOT call terminal-notifier
    expect(execSync).not.toHaveBeenCalledWith(
      expect.stringContaining('terminal-notifier'),
      expect.anything()
    );
  });

  it('should use status line CLI when oss-notify.sh not found', async () => {
    // GIVEN - No oss-notify.sh available
    vi.mocked(fs.existsSync).mockReturnValue(false);

    // WHEN - Sending notification

    // THEN - Should call status line CLI
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('update-workflow-state.js'),
      expect.anything()
    );
  });
});
```

### Task 1.2: Implement status line fallback in index.ts

**GREEN**: Replace terminal-notifier fallback with status line CLI call.

```typescript
private sendNotification(title: string, message: string, priority: 'low' | 'high' | 'critical' = 'high'): void {
  try {
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.dirname(this.ossDir);
    const notifyScript = path.join(pluginRoot, 'hooks', 'oss-notify.sh');

    if (fs.existsSync(notifyScript)) {
      execSync(`"${notifyScript}" "${title}" "${message}" ${priority}`, {
        timeout: 5000,
        stdio: 'ignore',
      });
    } else {
      // Fallback to status line CLI (NOT terminal-notifier)
      const cliPath = path.join(pluginRoot, 'watcher', 'dist', 'cli', 'update-workflow-state.js');
      if (fs.existsSync(cliPath)) {
        execSync(`node "${cliPath}" setMessage "${title}: ${message}"`, {
          timeout: 5000,
          stdio: 'ignore',
        });
      }
      // If neither available, silently fail - no terminal-notifier
    }
  } catch {
    // Ignore notification errors
  }
}
```

---

## Phase 2: Update watcher/src/queue/manager.ts (RED → GREEN → REFACTOR)

### Task 2.1: Test sendDebugNotification uses status line only

```typescript
/**
 * @behavior Queue debug notifications use status line only
 * @acceptance-criteria No terminal-notifier in queue manager
 * @business-rule All queue notifications use status line
 * @boundary queue
 */
describe('QueueManager sendDebugNotification', () => {
  it('should not call terminal-notifier directly', () => {
    // GIVEN - No oss-notify.sh available
    vi.mocked(fs.existsSync).mockReturnValue(false);

    // WHEN - Debug notification triggered
    manager.emit('task_added', event);

    // THEN - Should NOT call terminal-notifier
    expect(execSync).not.toHaveBeenCalledWith(
      expect.stringContaining('terminal-notifier'),
      expect.anything()
    );
  });
});
```

### Task 2.2: Implement status line fallback in queue/manager.ts

**GREEN**: Replace terminal-notifier fallback with status line CLI.

---

## Phase 3: Update watcher/src/cli/health-check.ts (RED → GREEN → REFACTOR)

### Task 3.1: Test sendNotification uses status line only

```typescript
/**
 * @behavior Health check notifications use status line only
 * @acceptance-criteria No terminal-notifier in health check
 * @business-rule All health notifications use status line
 * @boundary cli
 */
describe('health-check sendNotification', () => {
  it('should not call terminal-notifier directly', () => {
    // GIVEN - No oss-notify.sh available
    vi.mocked(fs.existsSync).mockReturnValue(false);

    // WHEN - Sending health notification
    sendNotification(pluginRoot, 'Health', 'Check complete', 'low');

    // THEN - Should NOT call terminal-notifier
    expect(execSync).not.toHaveBeenCalledWith(
      expect.stringContaining('terminal-notifier'),
      expect.anything()
    );
  });
});
```

### Task 3.2: Implement status line fallback in health-check.ts

**GREEN**: Replace terminal-notifier fallback with status line CLI.

---

## Phase 4: Update Comment References (REFACTOR)

### Task 4.1: Update watcher/src/intervention/generator.ts comment

Change line 140 from:
```typescript
* Create a notification for terminal-notifier
```
To:
```typescript
* Create a notification for status line
```

### Task 4.2: Update any JSDoc/comments referencing terminal-notifier

Search and update all comments that incorrectly suggest terminal-notifier is used.

---

## Phase 5: Rebuild and Verify (INTEGRATION)

### Task 5.1: Run all tests
```bash
cd /Users/ysl/dev/one-shot-ship-plugin/watcher && npm test
```

### Task 5.2: Rebuild dist
```bash
cd /Users/ysl/dev/one-shot-ship-plugin/watcher && npm run build
```

### Task 5.3: Verify no terminal-notifier in watcher src (except comments about removal)
```bash
grep -r "terminal-notifier" watcher/src/ | grep -v "not.*terminal-notifier" | grep -v "// removed" | grep -v test
```
Should return empty or only reference oss-stop.sh/session-start.

---

## Acceptance Criteria

- [ ] `watcher/src/index.ts` - No terminal-notifier fallback
- [ ] `watcher/src/queue/manager.ts` - No terminal-notifier fallback
- [ ] `watcher/src/cli/health-check.ts` - No terminal-notifier fallback
- [ ] All tests pass (100%)
- [ ] Build succeeds
- [ ] `hooks/oss-stop.sh` - STILL uses terminal-notifier for "Done" (KEEP)
- [ ] Session start - STILL uses terminal-notifier for "Ready" (KEEP if exists)

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| Phase 1 | 2 | watcher/src/index.ts |
| Phase 2 | 2 | watcher/src/queue/manager.ts |
| Phase 3 | 2 | watcher/src/cli/health-check.ts |
| Phase 4 | 2 | Comment updates |
| Phase 5 | 3 | Integration verification |
| **Total** | **11** | |

---

## Command Chain

After plan approval:
1. `/oss:build` - Execute TDD tasks
2. `/oss:ship --merge` - Ship the fix

---

*Last Updated: 2024-12-23*
*Status: PENDING APPROVAL*
