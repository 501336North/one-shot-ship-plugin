/**
 * @behavior Error messages are helpful, actionable, and never cryptic
 * @acceptance-criteria Every error includes: what happened, why, and how to fix
 * @business-rule Stripe-level error quality reduces support burden
 */

import { describe, it, expect } from 'vitest';

describe('Error Messages Service', () => {
  describe('formatError', () => {
    it('should include what happened in error message', async () => {
      const { formatError } = await import('../../src/services/error-messages');

      const error = formatError('AUTH_FAILED', { email: 'test@example.com' });

      expect(error.message).toContain('Authentication failed');
    });

    it('should include why it happened', async () => {
      const { formatError } = await import('../../src/services/error-messages');

      const error = formatError('AUTH_FAILED', {});

      expect(error.reason).toBeDefined();
      expect(error.reason).toContain('API key');
    });

    it('should include how to fix it', async () => {
      const { formatError } = await import('../../src/services/error-messages');

      const error = formatError('AUTH_FAILED', {});

      expect(error.fix).toBeDefined();
      expect(error.fix).toContain('/oss:login');
    });

    it('should include documentation link when available', async () => {
      const { formatError } = await import('../../src/services/error-messages');

      const error = formatError('SUBSCRIPTION_EXPIRED', {});

      expect(error.docsUrl).toBeDefined();
      expect(error.docsUrl).toContain('oneshotship.com');
    });
  });

  describe('error codes', () => {
    it('should have descriptive error codes', async () => {
      const { ERROR_CODES } = await import('../../src/services/error-messages');

      expect(ERROR_CODES.AUTH_FAILED).toBeDefined();
      expect(ERROR_CODES.SUBSCRIPTION_EXPIRED).toBeDefined();
      expect(ERROR_CODES.NETWORK_ERROR).toBeDefined();
      expect(ERROR_CODES.PROMPT_NOT_FOUND).toBeDefined();
      expect(ERROR_CODES.RATE_LIMITED).toBeDefined();
    });

    it('should map HTTP status codes to error codes', async () => {
      const { httpStatusToErrorCode } = await import('../../src/services/error-messages');

      expect(httpStatusToErrorCode(401)).toBe('AUTH_FAILED');
      expect(httpStatusToErrorCode(403)).toBe('SUBSCRIPTION_EXPIRED');
      expect(httpStatusToErrorCode(404)).toBe('PROMPT_NOT_FOUND');
      expect(httpStatusToErrorCode(429)).toBe('RATE_LIMITED');
      expect(httpStatusToErrorCode(500)).toBe('SERVER_ERROR');
    });
  });

  describe('user-friendly formatting', () => {
    it('should format error for terminal display', async () => {
      const { formatErrorForTerminal } = await import('../../src/services/error-messages');

      const output = formatErrorForTerminal('AUTH_FAILED', {});

      expect(output).toContain('Error:');
      expect(output).toContain('Fix:');
    });

    it('should not expose internal stack traces to users', async () => {
      const { formatError } = await import('../../src/services/error-messages');

      const error = formatError('SERVER_ERROR', { stack: 'at Object.<anonymous>' });

      expect(error.message).not.toContain('Object.<anonymous>');
      expect(error.message).not.toContain('stack');
    });

    it('should sanitize sensitive data from error context', async () => {
      const { formatError } = await import('../../src/services/error-messages');

      const error = formatError('AUTH_FAILED', {
        apiKey: 'ak_secret_12345',
        password: 'hunter2',
      });

      expect(JSON.stringify(error)).not.toContain('ak_secret');
      expect(JSON.stringify(error)).not.toContain('hunter2');
    });
  });
});
