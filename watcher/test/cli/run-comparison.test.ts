/**
 * @file Run Comparison CLI Tests
 * @description Tests for the run-comparison CLI command
 *
 * @behavior RunComparison CLI orchestrates the full comparison loop
 * @acceptance-criteria AC-RUN-COMPARISON.1 through AC-RUN-COMPARISON.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseRunComparisonArgs,
  executeRunComparison,
  type RunComparisonArgs,
} from '../../src/cli/run-comparison.js';

// Mock fs module for file operations
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
  };
});

describe('Run Comparison CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseRunComparisonArgs', () => {
    it('should parse --model flag', () => {
      const args = parseRunComparisonArgs(['--model', 'qwen2.5-coder:7b']);
      expect(args.model).toBe('qwen2.5-coder:7b');
    });

    it('should parse --category flag', () => {
      const args = parseRunComparisonArgs(['--category', 'code-review']);
      expect(args.category).toBe('code-review');
    });

    it('should parse --output flag', () => {
      const args = parseRunComparisonArgs(['--output', '/tmp/report.md']);
      expect(args.output).toBe('/tmp/report.md');
    });

    it('should parse --help flag', () => {
      const args = parseRunComparisonArgs(['--help']);
      expect(args.showHelp).toBe(true);
    });

    it('should use default values when no flags provided', () => {
      const args = parseRunComparisonArgs([]);
      expect(args.model).toBe('qwen2.5-coder:7b');
      expect(args.category).toBeUndefined();
      expect(args.showHelp).toBe(false);
    });
  });

  describe('executeRunComparison', () => {
    it('should return help text when --help is passed', async () => {
      const args: RunComparisonArgs = {
        model: 'qwen2.5-coder:7b',
        showHelp: true,
      };

      const result = await executeRunComparison(args);

      expect(result).toContain('Usage:');
      expect(result).toContain('run-comparison');
      expect(result).toContain('--model');
      expect(result).toContain('--category');
    });

    it('should output progress messages during execution', async () => {
      const progressMessages: string[] = [];
      const args: RunComparisonArgs = {
        model: 'qwen2.5-coder:7b',
        category: 'code-review', // Use single category for faster test
        showHelp: false,
        onProgress: (msg: string) => progressMessages.push(msg),
        // Mock components for testing
        mockMode: true,
      };

      await executeRunComparison(args);

      // Should have progress messages for each step
      expect(progressMessages.some((m) => m.toLowerCase().includes('baseline'))).toBe(true);
      expect(progressMessages.some((m) => m.toLowerCase().includes('challenger'))).toBe(true);
      expect(progressMessages.some((m) => m.toLowerCase().includes('judging') || m.toLowerCase().includes('quality'))).toBe(true);
    });

    it('should save report to ~/.oss/benchmarks/ by default', async () => {
      const args: RunComparisonArgs = {
        model: 'qwen2.5-coder:7b',
        category: 'code-review',
        showHelp: false,
        mockMode: true,
      };

      const result = await executeRunComparison(args);

      // Should indicate where report was saved
      expect(result).toContain('.oss/benchmarks/');
      expect(fs.writeFileSync).toHaveBeenCalled();

      // Verify path includes ~/.oss/benchmarks/
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const savedPath = writeCall[0] as string;
      expect(savedPath).toContain(path.join(os.homedir(), '.oss', 'benchmarks'));
    });

    it('should save report to custom output path when --output is specified', async () => {
      const customPath = '/tmp/custom-report.md';
      const args: RunComparisonArgs = {
        model: 'qwen2.5-coder:7b',
        category: 'code-review',
        output: customPath,
        showHelp: false,
        mockMode: true,
      };

      await executeRunComparison(args);

      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const savedPath = writeCall[0] as string;
      expect(savedPath).toBe(customPath);
    });

    it('should filter tasks by category when --category is specified', async () => {
      const args: RunComparisonArgs = {
        model: 'qwen2.5-coder:7b',
        category: 'bug-fix',
        showHelp: false,
        mockMode: true,
      };

      const result = await executeRunComparison(args);

      // Report should indicate only bug-fix tasks were run
      expect(result).toContain('bug-fix');
    });

    it('should handle error scenarios gracefully', async () => {
      const args: RunComparisonArgs = {
        model: 'nonexistent-model',
        category: 'code-review',
        showHelp: false,
        mockMode: true,
      };

      // Mock mode should complete without error
      const result = await executeRunComparison(args);

      // Should return a structured result (success or failure verdict)
      expect(result).toMatch(/Verdict:|Error/);
    });
  });
});
