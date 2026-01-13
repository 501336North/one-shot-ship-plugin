/**
 * @behavior Plugin defines wildcard bash permissions for reduced approval friction
 * @acceptance-criteria Task 1.1 - Wildcard Bash Permissions
 * @business-rule Users should not need to approve common OSS workflow commands
 * @boundary Plugin Configuration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Wildcard Bash Permissions', () => {
  let hooksConfig: any;
  const hooksJsonPath = path.resolve(__dirname, '../../../hooks/hooks.json');

  beforeAll(() => {
    const content = fs.readFileSync(hooksJsonPath, 'utf-8');
    hooksConfig = JSON.parse(content);
  });

  describe('Permission Patterns Configuration', () => {
    it('should have a permissions block in hooks.json', () => {
      expect(hooksConfig.permissions).toBeDefined();
      expect(hooksConfig.permissions.allow).toBeDefined();
      expect(Array.isArray(hooksConfig.permissions.allow)).toBe(true);
    });

    it('should allow plugin hook scripts', () => {
      const allowList = hooksConfig.permissions.allow;
      const hasHookPattern = allowList.some((pattern: string) =>
        pattern.includes('$CLAUDE_PLUGIN_ROOT/hooks/')
      );
      expect(hasHookPattern).toBe(true);
    });

    it('should allow npm test command', () => {
      const allowList = hooksConfig.permissions.allow;
      const hasNpmTest = allowList.some((pattern: string) =>
        pattern.includes('npm test') || pattern.includes('npm *')
      );
      expect(hasNpmTest).toBe(true);
    });

    it('should allow git operations', () => {
      const allowList = hooksConfig.permissions.allow;
      const hasGitPattern = allowList.some((pattern: string) =>
        pattern.includes('git ')
      );
      expect(hasGitPattern).toBe(true);
    });

    it('should allow GitHub CLI for PRs', () => {
      const allowList = hooksConfig.permissions.allow;
      const hasGhPattern = allowList.some((pattern: string) =>
        pattern.includes('gh pr') || pattern.includes('gh *')
      );
      expect(hasGhPattern).toBe(true);
    });

    it('should NOT have overly broad Bash(*) pattern', () => {
      const allowList = hooksConfig.permissions.allow;
      const hasDangerousPattern = allowList.some((pattern: string) =>
        pattern === 'Bash(*)' || pattern === '*'
      );
      expect(hasDangerousPattern).toBe(false);
    });
  });

  describe('Security Best Practices', () => {
    it('should have at least 5 specific permission patterns', () => {
      const allowList = hooksConfig.permissions.allow;
      expect(allowList.length).toBeGreaterThanOrEqual(5);
    });

    it('should use Bash() wrapper format for patterns', () => {
      const allowList = hooksConfig.permissions.allow;
      const allUseBashWrapper = allowList.every((pattern: string) =>
        pattern.startsWith('Bash(') && pattern.endsWith(')')
      );
      expect(allUseBashWrapper).toBe(true);
    });
  });
});
