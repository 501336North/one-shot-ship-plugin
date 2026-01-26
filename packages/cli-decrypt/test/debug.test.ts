/**
 * @behavior Debug output includes timestamps and step markers
 * @acceptance-criteria AC-DEBUG-001
 * @business-rule DEBUG-001
 * @boundary CLI
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DebugLogger, formatDebugOutput, redactSensitiveData } from '../src/debug.js';

describe('Debug Output', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('DebugLogger', () => {
    it('should not log when debug is disabled', () => {
      const logger = new DebugLogger(false);
      logger.log('FETCH', 'Fetching prompt');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should log with timestamp when debug is enabled', () => {
      const logger = new DebugLogger(true);
      logger.log('FETCH', 'Fetching prompt');
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
    });

    it('should log with step marker', () => {
      const logger = new DebugLogger(true);
      logger.log('DERIVE', 'Deriving key');
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('[DERIVE]');
    });

    it('should support FETCH step marker', () => {
      const logger = new DebugLogger(true);
      logger.log('FETCH', 'Making API request');
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('[FETCH]');
    });

    it('should support DECRYPT step marker', () => {
      const logger = new DebugLogger(true);
      logger.log('DECRYPT', 'Decrypting content');
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('[DECRYPT]');
    });

    it('should support CACHE step marker', () => {
      const logger = new DebugLogger(true);
      logger.log('CACHE', 'Checking cache');
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('[CACHE]');
    });
  });

  describe('redactSensitiveData', () => {
    it('should redact apiKey values', () => {
      const input = { apiKey: 'ak_secret123', name: 'test' };
      const result = redactSensitiveData(input);
      expect(result.apiKey).toBe('ak_***');
      expect(result.name).toBe('test');
    });

    it('should redact salt values', () => {
      const input = { salt: 'abc123def456', type: 'commands' };
      const result = redactSensitiveData(input);
      expect(result.salt).toBe('***');
      expect(result.type).toBe('commands');
    });

    it('should redact password values', () => {
      const input = { password: 'mysecret', user: 'admin' };
      const result = redactSensitiveData(input);
      expect(result.password).toBe('***');
      expect(result.user).toBe('admin');
    });

    it('should preserve non-sensitive values', () => {
      const input = { type: 'commands', name: 'plan', duration: 150 };
      const result = redactSensitiveData(input);
      expect(result).toEqual(input);
    });

    it('should handle nested objects', () => {
      const input = { credentials: { apiKey: 'secret' }, data: { name: 'test' } };
      const result = redactSensitiveData(input);
      expect(result.credentials.apiKey).toBe('ak_***');
      expect(result.data.name).toBe('test');
    });
  });

  describe('formatDebugOutput', () => {
    it('should include timestamp in output', () => {
      const result = formatDebugOutput('FETCH', 'test message');
      expect(result).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
    });

    it('should include step marker in output', () => {
      const result = formatDebugOutput('DERIVE', 'deriving key');
      expect(result).toContain('[DERIVE]');
    });

    it('should include message in output', () => {
      const result = formatDebugOutput('FETCH', 'Fetching from API');
      expect(result).toContain('Fetching from API');
    });
  });
});
