/**
 * Refactored Prompts Tests
 *
 * @behavior Command prompts should not contain hardcoded chains/agents
 * @acceptance-criteria AC-WF-PROMPT.1 through AC-WF-PROMPT.4
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMMANDS_DIR = '/Users/ysl/dev/one-shot-ship-plugin/commands';

describe('RefactoredPrompts', () => {
  /**
   * Helper to read a command file
   */
  function readCommand(name: string): string {
    const filePath = path.join(COMMANDS_DIR, `${name}.md`);
    return fs.readFileSync(filePath, 'utf-8');
  }

  describe('ideate.md', () => {
    it('should not contain hardcoded command chains', () => {
      const content = readCommand('ideate');

      // These exact hardcoded chains should NOT be present
      // The dynamic workflow engine section should be there instead
      const hardcodedChains = [
        'After ideation is complete, execute these commands in sequence:',
        '1. `/oss:requirements`',
        '2. `/oss:api-design`',
        '3. `/oss:data-model`',
        '4. `/oss:adr`',
        '5. `/oss:plan`',
      ];

      // Check that the old hardcoded section is replaced
      for (const chain of hardcodedChains) {
        expect(content).not.toContain(chain);
      }

      // Check that the new workflow engine section is present
      expect(content).toContain('Command Orchestration');
      expect(content).toContain('workflow engine');
    });
  });

  describe('plan.md', () => {
    it('should not contain hardcoded command chains', () => {
      const content = readCommand('plan');

      // These exact hardcoded chains should NOT be present
      const hardcodedChains = [
        'After the plan is approved, execute these commands in sequence:',
        '1. `/oss:acceptance`',
        '2. `/oss:build`',
      ];

      // Check that the old hardcoded section is replaced
      for (const chain of hardcodedChains) {
        expect(content).not.toContain(chain);
      }

      // Check that the new workflow engine section is present
      expect(content).toContain('Command Orchestration');
      expect(content).toContain('workflow engine');
    });
  });

  describe('build.md', () => {
    it('should not contain hardcoded agent list', () => {
      const content = readCommand('build');

      // The hardcoded integration/ship command chain should be replaced
      // Note: "After all tasks complete:" exists in Step 7 for logging, which is fine
      // We're checking for the specific numbered command sequence
      const hardcodedChains = [
        '1. `/oss:integration` - Validate mock/reality alignment',
        '2. `/oss:ship` - Quality gates + PR + merge',
      ];

      for (const chain of hardcodedChains) {
        expect(content).not.toContain(chain);
      }

      // Check that the new workflow engine section is present
      expect(content).toContain('Command Orchestration');
      expect(content).toContain('workflow engine');
    });
  });

  describe('ship.md', () => {
    it('should not contain hardcoded quality gates', () => {
      const content = readCommand('ship');

      // The explicit agent names in the quality gates diagram should be replaced
      // with a reference to the workflow config
      const hardcodedQualityGates = [
        '│  │ code-reviewer   │  │ performance-    │  │ security-       │',
        '│  │ auditor         │  │ auditor         │',
      ];

      for (const gate of hardcodedQualityGates) {
        expect(content).not.toContain(gate);
      }

      // Should reference workflow config for quality gates
      expect(content).toContain('workflow config');
      expect(content).toContain('quality_gates');
    });
  });

  describe('all prompts', () => {
    it('should contain workflow orchestration section', () => {
      const prompts = ['ideate', 'plan', 'build', 'ship'];

      for (const prompt of prompts) {
        const content = readCommand(prompt);
        expect(content).toContain('## Command Orchestration');
      }
    });

    it('should reference API-driven workflow config', () => {
      const prompts = ['ideate', 'plan', 'build', 'ship'];

      for (const prompt of prompts) {
        const content = readCommand(prompt);
        expect(content).toContain('fetched from the API');
      }
    });
  });
});
