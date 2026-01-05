/**
 * @behavior Error code system provides structured, actionable error information
 * @acceptance-criteria Every error has code, category, message, and recovery steps
 * @business-rule Errors should enable self-service recovery
 * @boundary Service (ErrorCodes)
 */

import { describe, it, expect } from 'vitest';

describe('Error Code System', () => {
  describe('error code structure', () => {
    /**
     * @behavior Error codes follow OSS-CATEGORY-NNN format
     * @acceptance-criteria Code is parseable and categorized
     */
    it('should create error with proper code format', async () => {
      const { OSSError, ErrorCategory } = await import('../../src/services/error-codes');

      const error = new OSSError({
        code: 'OSS-AUTH-001',
        category: ErrorCategory.AUTH,
        message: 'Authentication failed',
        cause: 'Invalid or expired API key',
        recovery: ['Run /oss:login to re-authenticate', 'Check your API key at oneshotship.com'],
        learnMore: 'https://docs.oneshotship.com/errors/auth/001',
      });

      expect(error.code).toBe('OSS-AUTH-001');
      expect(error.category).toBe(ErrorCategory.AUTH);
      expect(error.recovery).toHaveLength(2);
    });

    /**
     * @behavior Error codes include related commands
     * @acceptance-criteria Related commands suggest next actions
     */
    it('should include related commands', async () => {
      const { OSSError, ErrorCategory } = await import('../../src/services/error-codes');

      const error = new OSSError({
        code: 'OSS-TDD-001',
        category: ErrorCategory.TDD,
        message: 'Tests are failing',
        cause: 'Test assertions did not pass',
        recovery: ['Fix failing tests before proceeding'],
        learnMore: 'https://docs.oneshotship.com/errors/tdd/001',
        relatedCommands: ['/oss:debug', '/oss:red'],
      });

      expect(error.relatedCommands).toContain('/oss:debug');
    });
  });

  describe('error categories', () => {
    /**
     * @behavior All error categories are defined
     * @acceptance-criteria AUTH, WORKFLOW, TDD, GIT, CONFIG, API categories exist
     */
    it('should have all required categories', async () => {
      const { ErrorCategory } = await import('../../src/services/error-codes');

      expect(ErrorCategory.AUTH).toBe('auth');
      expect(ErrorCategory.WORKFLOW).toBe('workflow');
      expect(ErrorCategory.TDD).toBe('tdd');
      expect(ErrorCategory.GIT).toBe('git');
      expect(ErrorCategory.CONFIG).toBe('config');
      expect(ErrorCategory.API).toBe('api');
    });
  });

  describe('error registry', () => {
    /**
     * @behavior Error registry contains predefined errors
     * @acceptance-criteria Can lookup error by code
     */
    it('should lookup error by code', async () => {
      const { ErrorRegistry } = await import('../../src/services/error-codes');

      const registry = new ErrorRegistry();
      const error = registry.getError('OSS-AUTH-001');

      expect(error).toBeDefined();
      expect(error?.code).toBe('OSS-AUTH-001');
      expect(error?.message).toBeDefined();
    });

    /**
     * @behavior Error registry returns undefined for unknown codes
     * @acceptance-criteria Unknown codes return gracefully
     */
    it('should return undefined for unknown codes', async () => {
      const { ErrorRegistry } = await import('../../src/services/error-codes');

      const registry = new ErrorRegistry();
      const error = registry.getError('OSS-FAKE-999');

      expect(error).toBeUndefined();
    });

    /**
     * @behavior Error registry can list all errors by category
     * @acceptance-criteria Can filter errors by category
     */
    it('should list errors by category', async () => {
      const { ErrorRegistry, ErrorCategory } = await import('../../src/services/error-codes');

      const registry = new ErrorRegistry();
      const authErrors = registry.getByCategory(ErrorCategory.AUTH);

      expect(authErrors.length).toBeGreaterThan(0);
      expect(authErrors.every(e => e.category === ErrorCategory.AUTH)).toBe(true);
    });
  });

  describe('error formatting', () => {
    /**
     * @behavior Error can format as user-friendly message
     * @acceptance-criteria Output includes code, message, and recovery
     */
    it('should format error for display', async () => {
      const { OSSError, ErrorCategory } = await import('../../src/services/error-codes');

      const error = new OSSError({
        code: 'OSS-AUTH-001',
        category: ErrorCategory.AUTH,
        message: 'Authentication failed',
        cause: 'Invalid API key',
        recovery: ['Run /oss:login'],
        learnMore: 'https://docs.example.com',
      });

      const formatted = error.format();

      expect(formatted).toContain('OSS-AUTH-001');
      expect(formatted).toContain('Authentication failed');
      expect(formatted).toContain('Run /oss:login');
      expect(formatted).toContain('https://docs.example.com');
    });

    /**
     * @behavior Error can format as compact single line
     * @acceptance-criteria Compact format for status line display
     */
    it('should format error as compact', async () => {
      const { OSSError, ErrorCategory } = await import('../../src/services/error-codes');

      const error = new OSSError({
        code: 'OSS-AUTH-001',
        category: ErrorCategory.AUTH,
        message: 'Authentication failed',
        cause: 'Invalid API key',
        recovery: ['Run /oss:login'],
        learnMore: 'https://docs.example.com',
      });

      const compact = error.formatCompact();

      expect(compact).toContain('OSS-AUTH-001');
      expect(compact).toContain('Authentication failed');
      expect(compact.split('\n')).toHaveLength(1);
    });
  });

  describe('predefined errors', () => {
    /**
     * @behavior Common auth errors are predefined
     * @acceptance-criteria OSS-AUTH-001 through OSS-AUTH-003 exist
     */
    it('should have predefined auth errors', async () => {
      const { ErrorRegistry } = await import('../../src/services/error-codes');

      const registry = new ErrorRegistry();

      expect(registry.getError('OSS-AUTH-001')).toBeDefined(); // Invalid API key
      expect(registry.getError('OSS-AUTH-002')).toBeDefined(); // Subscription expired
      expect(registry.getError('OSS-AUTH-003')).toBeDefined(); // Not authenticated
    });

    /**
     * @behavior Common TDD errors are predefined
     * @acceptance-criteria OSS-TDD-001 through OSS-TDD-003 exist
     */
    it('should have predefined TDD errors', async () => {
      const { ErrorRegistry } = await import('../../src/services/error-codes');

      const registry = new ErrorRegistry();

      expect(registry.getError('OSS-TDD-001')).toBeDefined(); // Tests failing
      expect(registry.getError('OSS-TDD-002')).toBeDefined(); // Code before test
      expect(registry.getError('OSS-TDD-003')).toBeDefined(); // Flaky test
    });

    /**
     * @behavior Common Git errors are predefined
     * @acceptance-criteria OSS-GIT-001 through OSS-GIT-003 exist
     */
    it('should have predefined Git errors', async () => {
      const { ErrorRegistry } = await import('../../src/services/error-codes');

      const registry = new ErrorRegistry();

      expect(registry.getError('OSS-GIT-001')).toBeDefined(); // On main branch
      expect(registry.getError('OSS-GIT-002')).toBeDefined(); // Uncommitted changes
      expect(registry.getError('OSS-GIT-003')).toBeDefined(); // Push failed
    });
  });
});
