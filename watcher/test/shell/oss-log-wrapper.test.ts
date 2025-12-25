/**
 * @behavior OssLogWrapper abstracts oss-log.sh execution
 * @acceptance-criteria Unit tests can verify logging behavior without spawning bash
 * @business-rule Fast unit tests should not spawn shell processes
 * @boundary Shell wrapper for oss-log.sh
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OssLogWrapper } from '../../src/shell/oss-log-wrapper.js';
import { MockShellExecutor } from '../../src/interfaces/shell-executor.js';

describe('OssLogWrapper', () => {
  let mockExecutor: MockShellExecutor;
  let wrapper: OssLogWrapper;
  const hooksPath = '/path/to/hooks';

  beforeEach(() => {
    mockExecutor = new MockShellExecutor();
    wrapper = new OssLogWrapper(mockExecutor, hooksPath);
  });

  describe('logHook', () => {
    /**
     * @behavior logHook calls oss-log.sh with hook action
     * @acceptance-criteria Executes: oss-log.sh hook <hookName> <event>
     */
    it('should call oss-log.sh hook with correct arguments', async () => {
      // GIVEN: A wrapper with mock executor
      mockExecutor.whenCalled(`${hooksPath}/oss-log.sh`, ['hook', 'SessionStart', 'START']).thenReturn({
        stdout: 'logged',
        stderr: '',
        exitCode: 0,
      });

      // WHEN: Calling logHook
      await wrapper.logHook('SessionStart', 'START');

      // THEN: oss-log.sh was called with correct args
      expect(mockExecutor.wasCalled(`${hooksPath}/oss-log.sh`, ['hook', 'SessionStart', 'START'])).toBe(true);
    });

    /**
     * @behavior logHook includes optional reason
     * @acceptance-criteria Executes: oss-log.sh hook <hookName> <event> <reason>
     */
    it('should include reason when provided', async () => {
      // GIVEN: A wrapper with mock executor
      mockExecutor.whenCalled(`${hooksPath}/oss-log.sh`, ['hook', 'oss-iron-law-check', 'FAILED', 'Violation detected']).thenReturn({
        stdout: 'logged',
        stderr: '',
        exitCode: 0,
      });

      // WHEN: Calling logHook with reason
      await wrapper.logHook('oss-iron-law-check', 'FAILED', 'Violation detected');

      // THEN: oss-log.sh was called with reason
      expect(mockExecutor.wasCalled(`${hooksPath}/oss-log.sh`, ['hook', 'oss-iron-law-check', 'FAILED', 'Violation detected'])).toBe(true);
    });
  });

  describe('logPhase', () => {
    /**
     * @behavior logPhase calls oss-log.sh with phase action
     * @acceptance-criteria Executes: oss-log.sh phase <workflow> <phase> <event>
     */
    it('should call oss-log.sh phase with correct arguments', async () => {
      // GIVEN: A wrapper with mock executor
      mockExecutor.whenCalled(`${hooksPath}/oss-log.sh`, ['phase', 'build', 'RED', 'start']).thenReturn({
        stdout: 'logged',
        stderr: '',
        exitCode: 0,
      });

      // WHEN: Calling logPhase
      await wrapper.logPhase('build', 'RED', 'start');

      // THEN: oss-log.sh was called with correct args
      expect(mockExecutor.wasCalled(`${hooksPath}/oss-log.sh`, ['phase', 'build', 'RED', 'start'])).toBe(true);
    });
  });

  describe('logTest', () => {
    /**
     * @behavior logTest calls oss-log.sh with test action
     * @acceptance-criteria Executes: oss-log.sh test <workflow> <result> <details>
     */
    it('should call oss-log.sh test with correct arguments', async () => {
      // GIVEN: A wrapper with mock executor
      mockExecutor.whenCalled(`${hooksPath}/oss-log.sh`, ['test', 'build', 'PASS', 'test.ts']).thenReturn({
        stdout: 'logged',
        stderr: '',
        exitCode: 0,
      });

      // WHEN: Calling logTest
      await wrapper.logTest('build', 'PASS', 'test.ts');

      // THEN: oss-log.sh was called with correct args
      expect(mockExecutor.wasCalled(`${hooksPath}/oss-log.sh`, ['test', 'build', 'PASS', 'test.ts'])).toBe(true);
    });
  });

  describe('init', () => {
    /**
     * @behavior init calls oss-log.sh with init action
     * @acceptance-criteria Executes: oss-log.sh init <workflow>
     */
    it('should call oss-log.sh init with correct arguments', async () => {
      // GIVEN: A wrapper with mock executor
      mockExecutor.whenCalled(`${hooksPath}/oss-log.sh`, ['init', 'build']).thenReturn({
        stdout: '/path/to/log',
        stderr: '',
        exitCode: 0,
      });

      // WHEN: Calling init
      const logPath = await wrapper.init('build');

      // THEN: oss-log.sh was called and returned log path
      expect(mockExecutor.wasCalled(`${hooksPath}/oss-log.sh`, ['init', 'build'])).toBe(true);
      expect(logPath).toBe('/path/to/log');
    });
  });
});
