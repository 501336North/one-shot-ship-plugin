/**
 * @behavior CLI entry point parses arguments and routes to commands
 * @acceptance-criteria AC-DECRYPT-008
 * @business-rule DECRYPT-008
 * @boundary CLI Entry Point
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { parseArgs, runCli } from '../src/cli-entry.js';
import * as setupCmd from '../src/commands/setup.js';
import * as decryptCmd from '../src/commands/decrypt.js';

// Mock commands
vi.mock('../src/commands/setup.js');
vi.mock('../src/commands/decrypt.js');

describe('CLI Entry Point', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(setupCmd.setupCommand).mockResolvedValue(undefined);
    vi.mocked(decryptCmd.decryptCommand).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseArgs', () => {
    it('should parse --help flag', () => {
      const args = parseArgs(['--help']);
      expect(args.help).toBe(true);
    });

    it('should parse --version flag', () => {
      const args = parseArgs(['--version']);
      expect(args.version).toBe(true);
    });

    it('should parse --setup flag', () => {
      const args = parseArgs(['--setup']);
      expect(args.setup).toBe(true);
    });

    it('should parse --type and --name options', () => {
      const args = parseArgs(['--type', 'commands', '--name', 'plan']);
      expect(args.type).toBe('commands');
      expect(args.name).toBe('plan');
    });

    /**
     * @behavior CLI accepts custom type for team custom commands
     * @acceptance-criteria AC-CUSTOM-TYPE-003
     * @business-rule CUSTOM-003
     * @boundary CLI Entry Point
     */
    it('should parse --type custom for team custom commands', () => {
      const args = parseArgs(['--type', 'custom', '--name', 'review-code-standards']);
      expect(args.type).toBe('custom');
      expect(args.name).toBe('review-code-standards');
    });

    /**
     * @behavior Users can enable verbose debug output
     * @acceptance-criteria AC-DEBUG-001
     * @business-rule DEBUG-001
     * @boundary CLI
     */
    it('should parse --debug flag', () => {
      const args = parseArgs(['--debug']);
      expect(args.debug).toBe(true);
    });

    it('should parse -d short flag for debug', () => {
      const args = parseArgs(['-d']);
      expect(args.debug).toBe(true);
    });

    it('should parse --debug with other options', () => {
      const args = parseArgs(['--debug', '--type', 'commands', '--name', 'plan']);
      expect(args.debug).toBe(true);
      expect(args.type).toBe('commands');
      expect(args.name).toBe('plan');
    });

    it('should handle --type without value gracefully', () => {
      const args = parseArgs(['--type']);
      expect(args.type).toBeUndefined();
    });

    it('should handle --name without value gracefully', () => {
      const args = parseArgs(['--name']);
      expect(args.name).toBeUndefined();
    });
  });

  describe('runCli', () => {
    it('should call setup command for --setup', async () => {
      await runCli(['--setup']);
      expect(setupCmd.setupCommand).toHaveBeenCalled();
    });

    it('should call decrypt command for --type --name', async () => {
      await runCli(['--type', 'commands', '--name', 'plan']);
      expect(decryptCmd.decryptCommand).toHaveBeenCalledWith('commands', 'plan', false, {
        noCache: undefined,
      });
    });

    it('should handle workflows type', async () => {
      await runCli(['--type', 'workflows', '--name', 'build']);
      expect(decryptCmd.decryptCommand).toHaveBeenCalledWith('workflows', 'build', false, {
        noCache: undefined,
      });
    });

    it('should pass debug flag to decrypt command', async () => {
      await runCli(['--debug', '--type', 'commands', '--name', 'plan']);
      expect(decryptCmd.decryptCommand).toHaveBeenCalledWith('commands', 'plan', true, {
        noCache: undefined,
      });
    });

    it('should pass --no-cache flag to decrypt command', async () => {
      await runCli(['--no-cache', '--type', 'commands', '--name', 'plan']);
      expect(decryptCmd.decryptCommand).toHaveBeenCalledWith('commands', 'plan', false, {
        noCache: true,
      });
    });

    it('should handle --clear-cache', async () => {
      await runCli(['--clear-cache']);
      expect(decryptCmd.decryptCommand).toHaveBeenCalledWith('commands', 'any', false, {
        clearCache: true,
      });
    });
  });
});
