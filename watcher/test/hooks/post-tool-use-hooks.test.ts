import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * @behavior PostToolUse hooks provide automatic quality feedback after edits
 * @acceptance-criteria AC-QUALITY-001
 * @business-rule Quality hooks run automatically after tool completion
 * @boundary Plugin hooks configuration
 */
describe('PostToolUse Hooks Configuration', () => {
  let hooksConfig: any;
  const hooksJsonPath = path.join(__dirname, '../../../.claude-plugin/hooks.json');

  beforeEach(() => {
    const content = fs.readFileSync(hooksJsonPath, 'utf-8');
    hooksConfig = JSON.parse(content);
  });

  describe('hooks.json structure', () => {
    it('should have PostToolUse section', () => {
      expect(hooksConfig.hooks).toHaveProperty('PostToolUse');
      expect(Array.isArray(hooksConfig.hooks.PostToolUse)).toBe(true);
    });

    it('should have at least 2 PostToolUse hooks', () => {
      expect(hooksConfig.hooks.PostToolUse.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Edit hook for JS/TS files', () => {
    it('should have matcher for Edit tool on JS/TS files', () => {
      const editHook = hooksConfig.hooks.PostToolUse.find(
        (h: any) => h.matcher && h.matcher.includes('Edit') && h.matcher.includes('ts|tsx|js|jsx')
      );
      expect(editHook).toBeDefined();
      expect(editHook.matcher).toContain('Edit');
    });

    it('should reference post-edit-quality.sh hook script', () => {
      const editHook = hooksConfig.hooks.PostToolUse.find(
        (h: any) => h.matcher && h.matcher.includes('Edit')
      );
      expect(editHook).toBeDefined();
      const hookCommand = editHook.hooks[0].command;
      expect(hookCommand).toContain('post-edit-quality.sh');
    });

    it('should match .ts, .tsx, .js, .jsx file extensions', () => {
      const editHook = hooksConfig.hooks.PostToolUse.find(
        (h: any) => h.matcher && h.matcher.includes('Edit')
      );
      expect(editHook).toBeDefined();
      // The matcher regex should match TypeScript and JavaScript files
      const matcher = editHook.matcher;
      expect(matcher).toMatch(/ts|tsx|js|jsx/);
    });
  });

  describe('Bash hook for PR detection', () => {
    it('should have matcher for Bash tool', () => {
      const bashHook = hooksConfig.hooks.PostToolUse.find(
        (h: any) => h.matcher && h.matcher.includes('Bash')
      );
      expect(bashHook).toBeDefined();
      expect(bashHook.matcher).toContain('Bash');
    });

    it('should reference post-bash-pr.sh hook script', () => {
      const bashHook = hooksConfig.hooks.PostToolUse.find(
        (h: any) => h.matcher && h.matcher.includes('Bash')
      );
      expect(bashHook).toBeDefined();
      const hookCommand = bashHook.hooks[0].command;
      expect(hookCommand).toContain('post-bash-pr.sh');
    });
  });

  describe('hook scripts exist', () => {
    const hooksDir = path.join(__dirname, '../../../hooks');

    it('should have post-edit-quality.sh script', () => {
      const scriptPath = path.join(hooksDir, 'post-edit-quality.sh');
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    it('should have post-bash-pr.sh script', () => {
      const scriptPath = path.join(hooksDir, 'post-bash-pr.sh');
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    it('post-edit-quality.sh should be executable', () => {
      const scriptPath = path.join(hooksDir, 'post-edit-quality.sh');
      if (fs.existsSync(scriptPath)) {
        const stats = fs.statSync(scriptPath);
        // Check if any execute bit is set (owner, group, or other)
        const isExecutable = (stats.mode & 0o111) !== 0;
        expect(isExecutable).toBe(true);
      }
    });

    it('post-bash-pr.sh should be executable', () => {
      const scriptPath = path.join(hooksDir, 'post-bash-pr.sh');
      if (fs.existsSync(scriptPath)) {
        const stats = fs.statSync(scriptPath);
        const isExecutable = (stats.mode & 0o111) !== 0;
        expect(isExecutable).toBe(true);
      }
    });
  });
});
