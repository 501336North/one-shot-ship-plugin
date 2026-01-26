/**
 * @behavior Plugin skills use oss-decrypt CLI for prompt fetching
 * @acceptance-criteria AC-DECRYPT-009
 * @business-rule DECRYPT-009
 * @boundary Plugin Integration
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Path to plugin commands directory
const PLUGIN_COMMANDS_DIR = '/Users/ysl/dev/one-shot-ship-plugin/commands';

// Commands that fetch prompts from API (should use CLI)
const COMMANDS_THAT_FETCH_PROMPTS = [
  'plan.md',
  'build.md',
  'ideate.md',
  'ship.md',
  'acceptance.md',
  'red.md',
  'green.md',
  'refactor.md',
  'integration.md',
  'debug.md',
  'review.md',
];

describe('Plugin Integration', () => {
  describe('Commands that fetch prompts', () => {
    it.each(COMMANDS_THAT_FETCH_PROMPTS)(
      '%s should reference oss-decrypt CLI',
      (commandFile) => {
        const filePath = join(PLUGIN_COMMANDS_DIR, commandFile);
        const content = readFileSync(filePath, 'utf-8');

        // Should contain reference to oss-decrypt CLI
        expect(content).toContain('~/.oss/bin/oss-decrypt');
      }
    );

    it.each(COMMANDS_THAT_FETCH_PROMPTS)(
      '%s should use --type and --name flags',
      (commandFile) => {
        const filePath = join(PLUGIN_COMMANDS_DIR, commandFile);
        const content = readFileSync(filePath, 'utf-8');

        // Should use proper CLI syntax
        expect(content).toMatch(/--type\s+(commands|workflows|skills|agents|hooks)/);
        expect(content).toMatch(/--name\s+\w+/);
      }
    );
  });

  describe('All command files exist', () => {
    it('should have all expected command files', () => {
      const files = readdirSync(PLUGIN_COMMANDS_DIR);

      for (const commandFile of COMMANDS_THAT_FETCH_PROMPTS) {
        expect(files).toContain(commandFile);
      }
    });
  });

  describe('Login command', () => {
    it('login.md should include CLI installation step', () => {
      const filePath = join(PLUGIN_COMMANDS_DIR, 'login.md');
      const content = readFileSync(filePath, 'utf-8');

      // Should include CLI download
      expect(content).toContain('oss-decrypt');
      expect(content).toContain('curl');
      expect(content).toContain('~/.oss/bin/oss-decrypt');
    });

    it('login.md should include CLI setup step', () => {
      const filePath = join(PLUGIN_COMMANDS_DIR, 'login.md');
      const content = readFileSync(filePath, 'utf-8');

      // Should include setup command
      expect(content).toContain('--setup');
    });
  });
});
