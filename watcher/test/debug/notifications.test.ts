/**
 * @behavior Debug workflow sends notifications at phase milestones
 * @acceptance-criteria AC-DBG-013
 * @business-rule NOTIF-001
 * @boundary Notifications
 */

import { describe, it, expect } from 'vitest';
import { createDebugNotification } from '../../src/debug/notifications.js';

describe('Debug Notifications', () => {
  describe('createDebugNotification', () => {
    /**
     * @behavior Users are notified when debug workflow starts
     * @acceptance-criteria AC-DBG-013.1
     */
    it('should create start notification params with bug summary', () => {
      const result = createDebugNotification('start', {
        summary: 'Login fails with TypeError',
      });

      expect(result.workflow).toBe('debug');
      expect(result.event).toBe('start');
      expect(result.context.summary).toBe('Login fails with TypeError');
    });

    /**
     * @behavior Users are notified when investigation phase completes
     * @acceptance-criteria AC-DBG-013.2
     */
    it('should create investigate_complete notification with root causes', () => {
      const result = createDebugNotification('investigate_complete', {
        rootCauses: 2,
        selectedCause: 'Null check missing',
      });

      expect(result.workflow).toBe('debug');
      expect(result.event).toBe('investigate_complete');
      expect(result.context.rootCauses).toBe(2);
      expect(result.context.selectedCause).toBe('Null check missing');
    });

    /**
     * @behavior Users are notified when reproduction phase completes
     * @acceptance-criteria AC-DBG-013.3
     */
    it('should create reproduce_complete notification with test path', () => {
      const result = createDebugNotification('reproduce_complete', {
        testPath: 'test/auth/bug-1234.test.ts',
        testFailed: true,
      });

      expect(result.workflow).toBe('debug');
      expect(result.event).toBe('reproduce_complete');
      expect(result.context.testPath).toBe('test/auth/bug-1234.test.ts');
      expect(result.context.testFailed).toBe(true);
    });

    /**
     * @behavior Users are notified when debug workflow completes
     * @acceptance-criteria AC-DBG-013.4
     */
    it('should create complete notification with task count and severity', () => {
      const result = createDebugNotification('complete', {
        severity: 'high',
        taskCount: 5,
        testPath: 'test/bug.test.ts',
        docsPath: 'dev/active/bugfix-login/DEBUG.md',
      });

      expect(result.workflow).toBe('debug');
      expect(result.event).toBe('complete');
      expect(result.context.severity).toBe('high');
      expect(result.context.taskCount).toBe(5);
      expect(result.context.testPath).toBe('test/bug.test.ts');
      expect(result.context.docsPath).toBe('dev/active/bugfix-login/DEBUG.md');
    });

    /**
     * @behavior Users are notified when debug workflow fails
     * @acceptance-criteria AC-DBG-013.5
     */
    it('should create failed notification with reason', () => {
      const result = createDebugNotification('failed', {
        reason: 'Could not reproduce bug',
        phase: 'reproduce',
      });

      expect(result.workflow).toBe('debug');
      expect(result.event).toBe('failed');
      expect(result.context.reason).toBe('Could not reproduce bug');
      expect(result.context.phase).toBe('reproduce');
    });
  });
});
