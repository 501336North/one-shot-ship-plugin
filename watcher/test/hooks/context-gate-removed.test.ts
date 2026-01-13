/**
 * Context Gate Removed Tests
 *
 * @behavior Context gate should be removed - major commands should not be blocked
 * @acceptance-criteria AC-CONTEXT.1 - No blocking for major commands
 * @business-rule The context gate adds friction without value since IRON LAWS
 *               are fetched by each command and state is loaded from dev docs
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Context Gate Removal', () => {
  const pluginRoot = path.resolve(__dirname, '../../../');
  const hooksDir = path.join(pluginRoot, 'hooks');
  const hooksJsonPath = path.join(pluginRoot, '.claude-plugin/hooks.json');

  describe('AC-CONTEXT.1: Context gate file should be removed', () => {
    it('should not have oss-context-gate.sh in hooks directory', () => {
      const contextGatePath = path.join(hooksDir, 'oss-context-gate.sh');
      expect(fs.existsSync(contextGatePath)).toBe(false);
    });

    it('should not reference context-gate in hooks.json', () => {
      const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf-8'));
      const userPromptSubmitHooks = hooksJson.hooks?.UserPromptSubmit || [];

      const hasContextGate = userPromptSubmitHooks.some(
        (hook: { command?: string }) =>
          hook.command?.includes('context-gate')
      );

      expect(hasContextGate).toBe(false);
    });
  });

  describe('AC-CONTEXT.2: Precommand hook should remain functional', () => {
    it('should have oss-precommand.sh in hooks directory', () => {
      const precommandPath = path.join(hooksDir, 'oss-precommand.sh');
      expect(fs.existsSync(precommandPath)).toBe(true);
    });

    it('should have precommand hook in hooks.json', () => {
      const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf-8'));
      const userPromptSubmitHooks = hooksJson.hooks?.UserPromptSubmit || [];

      const hasPrecommand = userPromptSubmitHooks.some(
        (hook: { command?: string }) =>
          hook.command?.includes('precommand')
      );

      expect(hasPrecommand).toBe(true);
    });
  });
});
