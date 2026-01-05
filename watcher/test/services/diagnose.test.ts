/**
 * @behavior Diagnose service analyzes failures and provides actionable recovery
 * @acceptance-criteria Users can self-recover from common errors
 * @business-rule 80%+ error recovery without support
 * @boundary Service (DiagnoseService)
 */

import { describe, it, expect } from 'vitest';

describe('Diagnose Service', () => {
  describe('error detection', () => {
    /**
     * @behavior Can detect authentication errors
     * @acceptance-criteria Auth failures are correctly identified
     */
    it('should detect auth errors from output', async () => {
      const { DiagnoseService } = await import('../../src/services/diagnose');

      const service = new DiagnoseService();
      const result = service.analyze({
        command: 'plan',
        exitCode: 1,
        output: 'Error: Authentication failed. Invalid API key.',
      });

      expect(result.errorCode).toBe('OSS-AUTH-001');
      expect(result.category).toBe('auth');
    });

    /**
     * @behavior Can detect test failures
     * @acceptance-criteria Test failure patterns are recognized
     */
    it('should detect test failures', async () => {
      const { DiagnoseService } = await import('../../src/services/diagnose');

      const service = new DiagnoseService();
      const result = service.analyze({
        command: 'build',
        exitCode: 1,
        output: 'FAIL  test/example.test.ts\n  ✕ should do something\n  AssertionError: expected 1 to equal 2',
      });

      expect(result.errorCode).toBe('OSS-TDD-001');
      expect(result.category).toBe('tdd');
    });

    /**
     * @behavior Can detect git branch errors
     * @acceptance-criteria Main branch violations are detected
     */
    it('should detect main branch violations', async () => {
      const { DiagnoseService } = await import('../../src/services/diagnose');

      const service = new DiagnoseService();
      const result = service.analyze({
        command: 'ship',
        exitCode: 1,
        output: 'Error: Cannot push to protected branch main',
      });

      expect(result.errorCode).toBe('OSS-GIT-001');
      expect(result.category).toBe('git');
    });
  });

  describe('recovery suggestions', () => {
    /**
     * @behavior Provides specific recovery steps
     * @acceptance-criteria Recovery steps are actionable
     */
    it('should provide recovery steps for auth errors', async () => {
      const { DiagnoseService } = await import('../../src/services/diagnose');

      const service = new DiagnoseService();
      const result = service.analyze({
        command: 'plan',
        exitCode: 1,
        output: 'No API key found. Run /oss:login',
      });

      expect(result.recovery.length).toBeGreaterThan(0);
      expect(result.recovery.some(r => r.includes('/oss:login'))).toBe(true);
    });

    /**
     * @behavior Provides related commands
     * @acceptance-criteria Related commands help users continue
     */
    it('should suggest related commands', async () => {
      const { DiagnoseService } = await import('../../src/services/diagnose');

      const service = new DiagnoseService();
      const result = service.analyze({
        command: 'build',
        exitCode: 1,
        output: 'Tests failing: 3 failed, 10 passed',
      });

      expect(result.relatedCommands).toContain('/oss:debug');
    });
  });

  describe('output formatting', () => {
    /**
     * @behavior Can format diagnosis as readable report
     * @acceptance-criteria Report includes all relevant information
     */
    it('should format diagnosis report', async () => {
      const { DiagnoseService } = await import('../../src/services/diagnose');

      const service = new DiagnoseService();
      const result = service.analyze({
        command: 'ship',
        exitCode: 1,
        output: 'Error: git push failed',
      });

      const report = service.formatReport(result);

      expect(report).toContain('Diagnosis');
      expect(report).toContain('Recovery');
    });

    /**
     * @behavior Report includes confidence level
     * @acceptance-criteria Users know how certain the diagnosis is
     */
    it('should include confidence level', async () => {
      const { DiagnoseService } = await import('../../src/services/diagnose');

      const service = new DiagnoseService();
      const result = service.analyze({
        command: 'build',
        exitCode: 1,
        output: 'FAIL  tests: 5 failed',
      });

      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('pattern matching', () => {
    /**
     * @behavior Detects subscription expired errors
     * @acceptance-criteria Subscription errors are recognized
     */
    it('should detect subscription expired', async () => {
      const { DiagnoseService } = await import('../../src/services/diagnose');

      const service = new DiagnoseService();
      const result = service.analyze({
        command: 'plan',
        exitCode: 1,
        output: 'Subscription expired. Upgrade at: https://www.oneshotship.com/pricing',
      });

      expect(result.errorCode).toBe('OSS-AUTH-002');
    });

    /**
     * @behavior Detects API unavailable errors
     * @acceptance-criteria Network/API errors are recognized
     */
    it('should detect API unavailable', async () => {
      const { DiagnoseService } = await import('../../src/services/diagnose');

      const service = new DiagnoseService();
      const result = service.analyze({
        command: 'plan',
        exitCode: 1,
        output: 'Error: API temporarily unavailable. Status: 503',
      });

      expect(result.errorCode).toBe('OSS-API-001');
    });

    /**
     * @behavior Returns unknown error for unrecognized patterns
     * @acceptance-criteria Graceful handling of unknown errors
     */
    it('should handle unknown errors gracefully', async () => {
      const { DiagnoseService } = await import('../../src/services/diagnose');

      const service = new DiagnoseService();
      const result = service.analyze({
        command: 'unknown',
        exitCode: 1,
        output: 'Something completely unexpected happened XYZ123',
      });

      expect(result.errorCode).toBe('OSS-UNKNOWN-001');
      expect(result.confidence).toBeLessThan(0.5);
    });
  });
});
