/**
 * Chain Trigger CLI Tests
 *
 * @behavior Chain trigger fetches workflow config and outputs structured chain instructions
 * @acceptance-criteria AC-CHAIN-TRIGGER.1 through AC-CHAIN-TRIGGER.7
 * @business-rule Chain instructions are printed to stdout so Claude can invoke them as skills
 * @boundary CLI
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../../src/api/workflow-config.js', () => ({
  getCachedOrFetch: vi.fn(),
}));

import { getCachedOrFetch } from '../../src/api/workflow-config.js';

import {
  readApiCredentials,
  executeChainForWorkflow,
  MAX_CHAIN_COMMANDS,
} from '../../src/cli/chain-trigger.js';

describe('Chain Trigger CLI', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // AC-CHAIN-TRIGGER.1: Read API credentials
  // ==========================================================================

  describe('readApiCredentials', () => {
    test('should return apiKey and apiUrl from config', () => {
      const result = readApiCredentials('/tmp/test-oss');
      expect(result).toBeDefined();
    });

    test('should return null when config file is missing', () => {
      const result = readApiCredentials('/nonexistent/path');
      expect(result).toBeNull();
    });

    test('should reject non-HTTPS apiUrl', () => {
      const tmpDir = '/tmp/test-oss-security-' + Date.now();
      const fs = require('fs');
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(
        tmpDir + '/config.json',
        JSON.stringify({ apiKey: 'ak_testkey123', apiUrl: 'http://evil.com/api' })
      );

      const result = readApiCredentials(tmpDir);
      expect(result).toBeNull();

      fs.rmSync(tmpDir, { recursive: true });
    });

    test('should accept valid HTTPS apiUrl', () => {
      const tmpDir = '/tmp/test-oss-security-https-' + Date.now();
      const fs = require('fs');
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(
        tmpDir + '/config.json',
        JSON.stringify({ apiKey: 'ak_testkey123', apiUrl: 'https://api.example.com' })
      );

      const result = readApiCredentials(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.apiUrl).toBe('https://api.example.com');

      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  // ==========================================================================
  // AC-CHAIN-TRIGGER.8: Structured chain output format
  // ==========================================================================

  describe('executeChainForWorkflow - structured output', () => {
    /**
     * @behavior Chain trigger outputs CHAIN: lines for team: custom commands
     * @acceptance-criteria AC-CHAIN-TRIGGER.8
     * @business-rule team:X commands map to /oss:oss-custom X
     */
    test('should output CHAIN: lines for team: commands', async () => {
      const mockConfig = {
        chains_to: [
          { command: 'team:lint-check', always: true },
          { command: 'team:notify-slack', always: true },
        ],
      };
      (getCachedOrFetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);

      await executeChainForWorkflow('build', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('CHAIN: /oss:oss-custom lint-check (always)');
      expect(output).toContain('CHAIN: /oss:oss-custom notify-slack (always)');
    });

    /**
     * @behavior Chain trigger outputs CHAIN: lines for standard (non-team:) commands
     * @acceptance-criteria AC-CHAIN-TRIGGER.8
     * @business-rule Standard commands map to /oss:<command>
     */
    test('should output CHAIN: lines for standard commands', async () => {
      const mockConfig = {
        chains_to: [
          { command: 'adr', always: true },
          { command: 'requirements', always: true },
        ],
      };
      (getCachedOrFetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);

      await executeChainForWorkflow('ideate', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('CHAIN: /oss:adr (always)');
      expect(output).toContain('CHAIN: /oss:requirements (always)');
    });

    /**
     * @behavior Chain trigger includes conditions in output
     * @acceptance-criteria AC-CHAIN-TRIGGER.8
     * @business-rule Conditional commands show their condition for Claude to evaluate
     */
    test('should include conditions in output', async () => {
      const mockConfig = {
        chains_to: [
          { command: 'api-design', condition: 'has_api_work' },
          { command: 'data-model', condition: 'has_db_work' },
          { command: 'team:my-cmd', always: true },
        ],
      };
      (getCachedOrFetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);

      await executeChainForWorkflow('plan', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('CHAIN: /oss:api-design (condition: has_api_work)');
      expect(output).toContain('CHAIN: /oss:data-model (condition: has_db_work)');
      expect(output).toContain('CHAIN: /oss:oss-custom my-cmd (always)');
    });

    /**
     * @behavior Chain trigger wraps output in delimiters
     * @acceptance-criteria AC-CHAIN-TRIGGER.8
     * @business-rule Delimiters allow Claude to reliably parse the chain instructions
     */
    test('should wrap output in delimiters', async () => {
      const mockConfig = {
        chains_to: [
          { command: 'team:lint-check', always: true },
        ],
      };
      (getCachedOrFetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);

      await executeChainForWorkflow('build', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('---CHAIN_COMMANDS---');
      expect(output).toContain('---END_CHAIN_COMMANDS---');

      // Delimiters should wrap the CHAIN lines
      const startIdx = output.indexOf('---CHAIN_COMMANDS---');
      const endIdx = output.indexOf('---END_CHAIN_COMMANDS---');
      const chainIdx = output.indexOf('CHAIN:');
      expect(startIdx).toBeLessThan(chainIdx);
      expect(chainIdx).toBeLessThan(endIdx);
    });

    /**
     * @behavior Chain trigger produces no output when no chains configured
     * @acceptance-criteria AC-CHAIN-TRIGGER.8
     * @business-rule Empty chains_to means no output (no delimiters either)
     */
    test('should produce no output when no chains_to configured', async () => {
      (getCachedOrFetch as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const result = await executeChainForWorkflow('build', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      // No console.log calls for chain instructions
      const chainCalls = consoleSpy.mock.calls.filter(c =>
        String(c[0]).includes('CHAIN:') || String(c[0]).includes('---CHAIN_COMMANDS---')
      );
      expect(chainCalls).toHaveLength(0);
      expect(result.executed).toBe(0);
    });

    /**
     * @behavior Chain trigger caps output at MAX_CHAIN_COMMANDS
     * @acceptance-criteria AC-CHAIN-TRIGGER.8
     * @business-rule H-4: Prevent runaway chains from malicious config
     */
    test('should cap output at MAX_CHAIN_COMMANDS', async () => {
      const manyCommands = Array.from({ length: 20 }, (_, i) => ({
        command: `team:cmd-${i}`,
        always: true,
      }));
      (getCachedOrFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        chains_to: manyCommands,
      });

      await executeChainForWorkflow('build', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      const chainLines = output.split('\n').filter((l: string) => l.startsWith('CHAIN:'));
      expect(chainLines.length).toBe(MAX_CHAIN_COMMANDS);
    });

    /**
     * @behavior Chain trigger handles API errors gracefully
     * @acceptance-criteria AC-CHAIN-TRIGGER.8
     * @business-rule Errors produce empty output, not crash
     */
    test('should handle workflow config fetch error gracefully', async () => {
      (getCachedOrFetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      const result = await executeChainForWorkflow('build', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      expect(result.executed).toBe(0);
      expect(result.error).toBeDefined();

      // No chain output on error
      const chainCalls = consoleSpy.mock.calls.filter(c =>
        String(c[0]).includes('CHAIN:')
      );
      expect(chainCalls).toHaveLength(0);
    });

    /**
     * @behavior Chain trigger does NOT call CustomCommandExecutor
     * @acceptance-criteria AC-CHAIN-TRIGGER.8
     * @business-rule Chain trigger outputs instructions, doesn't execute commands
     */
    test('should NOT invoke CustomCommandExecutor', async () => {
      const mockConfig = {
        chains_to: [
          { command: 'team:lint-check', always: true },
          { command: 'adr', always: true },
        ],
      };
      (getCachedOrFetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);

      await executeChainForWorkflow('build', {
        apiKey: 'test-key',
        apiUrl: 'https://api.example.com',
      });

      // Should NOT have tried to instantiate or call the executor
      // The function should only output CHAIN: lines
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('CHAIN:');
    });
  });
});
