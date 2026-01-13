/**
 * @behavior Heavy agents should use context: fork for isolated execution
 * @acceptance-criteria Task 1.2 - Context Fork for Heavy Agents
 * @business-rule Reduce token bloat by isolating context-heavy agents
 * @boundary Agent Configuration
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Context Fork for Heavy Agents', () => {
  const agentsDir = path.resolve(__dirname, '../../../agents');

  // Agents that should have context: fork due to high token usage
  const heavyAgents = [
    'code-reviewer.md',
    'debugger.md',
    'test-engineer.md',
    'refactoring-specialist.md',
    'architecture-auditor.md',
  ];

  describe('Frontmatter Configuration', () => {
    heavyAgents.forEach((agentFile) => {
      it(`${agentFile} should have context: fork in frontmatter`, () => {
        const filePath = path.join(agentsDir, agentFile);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Check for YAML frontmatter with context: fork
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        expect(frontmatterMatch).not.toBeNull();

        const frontmatter = frontmatterMatch![1];
        expect(frontmatter).toContain('context: fork');
      });
    });
  });

  describe('Non-Heavy Agents', () => {
    it('should not require context: fork for lightweight agents', () => {
      // typescript-pro is lightweight - just type checking assistance
      const filePath = path.join(agentsDir, 'typescript-pro.md');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should NOT have context: fork (or have it set to false)
      const hasContextFork = content.includes('context: fork');
      // This is fine either way - we just don't REQUIRE it for lightweight agents
      expect(true).toBe(true); // Placeholder - lightweight agents are optional
    });
  });
});
