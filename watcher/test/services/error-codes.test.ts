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

  describe('wire contract (OSSError wire schema)', () => {
    /**
     * @behavior An OSSError carrying wire fields survives serialize → parse losslessly
     * @acceptance-criteria AC-002.2: severity, source, retry_eligible, retry_hint,
     *                      retry_cost, attempt, context deep-equal after round-trip
     * @business-rule The wire contract lets failure paths hand errors to the calling
     *                agent and the watcher without information loss
     */
    it('should serialize an OSSError with wire fields and parse it back losslessly', async () => {
      const { OSSError, ErrorCategory } = await import('../../src/services/error-codes');

      const original = new OSSError({
        code: 'OSS-API-001',
        category: ErrorCategory.API,
        message: 'Prompt fetch failed: ECONNREFUSED one-shot-ship-api.onrender.com',
        cause: 'The OSS API server is not responding',
        recovery: ['Wait a few minutes and try again'],
        learnMore: 'https://docs.oneshotship.com/errors/api/001',
        severity: 'HIGH',
        source: 'hooks/ensure-decrypt-cli.sh',
        retry_eligible: true,
        retry_hint: 'Wait 5s then re-run: node watcher/dist/cli/get-copy.js --cmd build',
        retry_cost: 'cheap',
        attempt: 0,
        context: { endpoint: '/api/v1/prompts/commands/build' },
      });

      // Serialize to the wire, cross a process boundary (JSON string), parse back
      const wire = original.toWireJSON();
      const parsed = OSSError.fromWireJSON(JSON.parse(JSON.stringify(wire)));

      expect(parsed.code).toBe('OSS-API-001');
      expect(parsed.category).toBe(ErrorCategory.API);
      expect(parsed.severity).toBe('HIGH');
      expect(parsed.source).toBe('hooks/ensure-decrypt-cli.sh');
      expect(parsed.message).toContain('ECONNREFUSED');
      expect(parsed.retry_eligible).toBe(true);
      expect(parsed.retry_hint).toBe(
        'Wait 5s then re-run: node watcher/dist/cli/get-copy.js --cmd build',
      );
      expect(parsed.retry_cost).toBe('cheap');
      expect(parsed.attempt).toBe(0);
      expect(parsed.context).toEqual({ endpoint: '/api/v1/prompts/commands/build' });

      // Lossless: re-serializing the parsed error yields an identical wire payload
      expect(parsed.toWireJSON()).toEqual(wire);
    });

    /**
     * @behavior Nonconforming wire payloads are rejected at the parse boundary
     * @acceptance-criteria Invalid severity/retry_cost and missing required fields
     *                      throw with the offending field named
     * @business-rule A malformed error must never propagate as a valid one
     */
    it('should reject construction with invalid severity or retry_cost values', async () => {
      const { OSSError } = await import('../../src/services/error-codes');

      const valid: Record<string, unknown> = {
        code: 'OSS-API-001',
        severity: 'HIGH',
        source: 'hooks/ensure-decrypt-cli.sh',
        message: 'Prompt fetch failed',
        retry_eligible: true,
        retry_cost: 'cheap',
        attempt: 0,
      };

      // Invalid enum values → rejected, naming the field
      expect(() => OSSError.fromWireJSON({ ...valid, severity: 'FATAL' })).toThrow(/severity/);
      expect(() => OSSError.fromWireJSON({ ...valid, retry_cost: 'free' })).toThrow(/retry_cost/);

      // Missing required fields → rejected, naming the field
      for (const field of [
        'code',
        'severity',
        'message',
        'source',
        'retry_eligible',
        'retry_cost',
        'attempt',
      ]) {
        const incomplete = { ...valid };
        delete incomplete[field];
        expect(() => OSSError.fromWireJSON(incomplete), `missing ${field} must throw`).toThrow(
          new RegExp(field),
        );
      }

      // Non-object payloads → rejected
      expect(() => OSSError.fromWireJSON(null)).toThrow();
      expect(() => OSSError.fromWireJSON('not an object')).toThrow();
    });

    /**
     * @behavior Wire-schema extension does not change existing error behavior
     * @acceptance-criteria AC-002.1: .format()/.formatCompact() output for a
     *                      pre-existing registry code is byte-identical
     * @business-rule diagnose.ts and every existing consumer keep working unchanged
     */
    it('should keep existing registry codes resolvable and diagnose formatting unchanged', async () => {
      const { ErrorRegistry } = await import('../../src/services/error-codes');

      const registry = new ErrorRegistry();
      const error = registry.getError('OSS-AUTH-001');
      expect(error).toBeDefined();

      // Byte-identical snapshot of the CURRENT format() output (ANSI codes included)
      const expectedFormat = [
        '\x1b[31m\x1b[1mError: OSS-AUTH-001\x1b[0m',
        '\x1b[31mInvalid or expired API key\x1b[0m',
        '',
        '\x1b[33mCause:\x1b[0m The API key provided is not valid or has expired',
        '',
        '\x1b[36mRecovery:\x1b[0m',
        '  • Run /oss:login to re-authenticate',
        '  • Check your API key at https://www.oneshotship.com/dashboard',
        '  • Generate a new API key if needed',
        '',
        '\x1b[34mRelated Commands:\x1b[0m /oss:login, /oss:status',
        '',
        '\x1b[2mLearn more: https://docs.oneshotship.com/errors/auth/001\x1b[0m',
      ].join('\n');
      expect(error?.format()).toBe(expectedFormat);

      const expectedCompact = '\x1b[31m[OSS-AUTH-001]\x1b[0m Invalid or expired API key';
      expect(error?.formatCompact()).toBe(expectedCompact);
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
     * @behavior Every Phase A failure mode resolves to a registry code carrying
     *           recovery steps and per-code wire defaults
     * @acceptance-criteria Codes exist with non-empty recovery[], correct category,
     *                      and sensible default severity/retry_eligible/retry_cost
     * @business-rule Hooks and CLIs emit by code; the registry is the single source
     *                of recovery guidance and retry policy defaults
     */
    it('should resolve each new Phase A code from the registry with recovery steps', async () => {
      const { ErrorRegistry, ErrorCategory } = await import('../../src/services/error-codes');

      const registry = new ErrorRegistry();

      const expectations: Array<{
        code: string;
        category: (typeof ErrorCategory)[keyof typeof ErrorCategory];
        severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
        retry_eligible: boolean;
        retry_cost: 'cheap' | 'expensive';
        recoveryMentions: string;
      }> = [
        // auth 401 — not retryable, user must re-authenticate
        {
          code: 'OSS-AUTH-001',
          category: ErrorCategory.AUTH,
          severity: 'HIGH',
          retry_eligible: false,
          retry_cost: 'cheap',
          recoveryMentions: '/oss:login',
        },
        // auth 403 — not retryable, user must upgrade/renew
        {
          code: 'OSS-AUTH-002',
          category: ErrorCategory.AUTH,
          severity: 'HIGH',
          retry_eligible: false,
          retry_cost: 'cheap',
          recoveryMentions: 'pricing',
        },
        // decrypt failure — retryable cheaply (re-fetch the decrypt CLI)
        {
          code: 'OSS-API-002',
          category: ErrorCategory.API,
          severity: 'HIGH',
          retry_eligible: true,
          retry_cost: 'cheap',
          recoveryMentions: '/oss:trust',
        },
        // network unreachable — the canonical cheap retryable failure
        {
          code: 'OSS-API-003',
          category: ErrorCategory.API,
          severity: 'HIGH',
          retry_eligible: true,
          retry_cost: 'cheap',
          recoveryMentions: 'network',
        },
        // config missing/invalid — user action required
        {
          code: 'OSS-CONFIG-002',
          category: ErrorCategory.CONFIG,
          severity: 'MEDIUM',
          retry_eligible: false,
          retry_cost: 'cheap',
          recoveryMentions: '/oss:login',
        },
        // workflow-log unwritable — user must fix filesystem state
        {
          code: 'OSS-WORKFLOW-002',
          category: ErrorCategory.WORKFLOW,
          severity: 'MEDIUM',
          retry_eligible: false,
          retry_cost: 'cheap',
          recoveryMentions: '.oss',
        },
      ];

      for (const expected of expectations) {
        const error = registry.getError(expected.code);
        expect(error, `${expected.code} must be registered`).toBeDefined();
        expect(error?.category, `${expected.code} category`).toBe(expected.category);
        expect(error?.recovery.length, `${expected.code} recovery steps`).toBeGreaterThan(0);
        expect(
          error?.recovery.join('\n'),
          `${expected.code} recovery must mention ${expected.recoveryMentions}`,
        ).toContain(expected.recoveryMentions);
        expect(error?.severity, `${expected.code} severity`).toBe(expected.severity);
        expect(error?.retry_eligible, `${expected.code} retry_eligible`).toBe(
          expected.retry_eligible,
        );
        expect(error?.retry_cost, `${expected.code} retry_cost`).toBe(expected.retry_cost);
      }
    });

    /**
     * @behavior Nonconforming error output has a dedicated wrap code
     * @acceptance-criteria OSS-WORKFLOW-901 resolves with retry_eligible: false
     * @business-rule The watcher's validation net wraps malformed error lines
     *                instead of dropping them — the wrap itself is never retried
     */
    it('should provide a dedicated nonconforming-error wrap code', async () => {
      const { ErrorRegistry, ErrorCategory } = await import('../../src/services/error-codes');

      const registry = new ErrorRegistry();
      const wrap = registry.getError('OSS-WORKFLOW-901');

      expect(wrap, 'OSS-WORKFLOW-901 must be registered').toBeDefined();
      expect(wrap?.category).toBe(ErrorCategory.WORKFLOW);
      expect(wrap?.retry_eligible).toBe(false);
      expect(wrap?.recovery.length).toBeGreaterThan(0);
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
