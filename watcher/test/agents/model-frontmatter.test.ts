import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * @behavior Agent .md files have correct model: frontmatter for cost/quality optimization
 * @user-story As a plugin user, I want agents to use the optimal Claude model
 *             so that critical tasks get best reasoning and routine tasks save cost
 */

const AGENTS_DIR = join(__dirname, '..', '..', '..', 'agents');

function parseFrontmatter(filePath: string): Record<string, string | boolean> {
  const content = readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontmatter: Record<string, string | boolean> = {};
  for (const line of match[1].split('\n')) {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length > 0) {
      const value = valueParts.join(':').trim();
      frontmatter[key.trim()] = value === 'true' ? true : value === 'false' ? false : value;
    }
  }
  return frontmatter;
}

// Agents that MUST use Opus — deep reasoning, high-stakes decisions
const OPUS_AGENTS = [
  'architecture-auditor',
  'security-auditor',
  'incident-responder',
  'performance-auditor',
  'backend-architect',
  'cloud-architect',
  'debugger',
  'code-reviewer',
];

// Agents that SHOULD use Haiku — mechanical, pattern-based, easily validated
const HAIKU_AGENTS = [
  'dependency-analyzer',
  'docs-architect',
  'git-workflow-manager',
  'release-manager',
  'seo-aeo-expert',
];

// Agents that inherit parent model (no model field)
const INHERIT_AGENTS = [
  'ai-engineer',
  'analytics-expert',
  'code-simplifier',
  'data-engineer',
  'database-admin',
  'database-optimizer',
  'deployment-engineer',
  'devops-troubleshooter',
  'figma-design-agent',
  'flutter-expert',
  'frontend-developer',
  'golang-pro',
  'graphql-architect',
  'ios-developer',
  'java-pro',
  'ml-engineer',
  'mobile-developer',
  'n8n-automation-specialist',
  'nextjs-developer',
  'performance-engineer',
  'python-pro',
  'qa-expert',
  'react-specialist',
  'refactoring-specialist',
  'rust-pro',
  'sre-engineer',
  'swift-macos-expert',
  'test-automator',
  'test-engineer',
  'typescript-pro',
  'visionos-developer',
];

const VALID_MODEL_VALUES = ['opus', 'sonnet', 'haiku'];

describe('Agent Model Frontmatter (Acceptance)', () => {
  describe('Opus agents — force upgrade for critical reasoning', () => {
    it.each(OPUS_AGENTS)(
      'should have model: opus in frontmatter for %s',
      (agentName) => {
        // GIVEN - An agent .md file that handles critical reasoning
        const filePath = join(AGENTS_DIR, `${agentName}.md`);

        // WHEN - I parse its frontmatter
        const frontmatter = parseFrontmatter(filePath);

        // THEN - It should specify model: opus
        expect(frontmatter.model).toBe('opus');
      }
    );
  });

  describe('Haiku agents — force downgrade for mechanical tasks', () => {
    it.each(HAIKU_AGENTS)(
      'should have model: haiku in frontmatter for %s',
      (agentName) => {
        // GIVEN - An agent .md file that handles mechanical/routine tasks
        const filePath = join(AGENTS_DIR, `${agentName}.md`);

        // WHEN - I parse its frontmatter
        const frontmatter = parseFrontmatter(filePath);

        // THEN - It should specify model: haiku
        expect(frontmatter.model).toBe('haiku');
      }
    );
  });

  describe('Inherit-parent agents — no model field', () => {
    it.each(INHERIT_AGENTS)(
      'should NOT have model field in frontmatter for %s',
      (agentName) => {
        // GIVEN - An agent .md file that should inherit parent model
        const filePath = join(AGENTS_DIR, `${agentName}.md`);

        // WHEN - I parse its frontmatter
        const frontmatter = parseFrontmatter(filePath);

        // THEN - It should NOT have a model field
        expect(frontmatter).not.toHaveProperty('model');
      }
    );
  });

  describe('Completeness and validity', () => {
    it('should account for all agent .md files across the three tiers', () => {
      // GIVEN - All agent .md files (excluding _shared directory)
      const allAgentFiles = readdirSync(AGENTS_DIR)
        .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
        .map((f) => f.replace('.md', ''));

      // WHEN - I combine all three tier lists
      const allCategorized = [...OPUS_AGENTS, ...HAIKU_AGENTS, ...INHERIT_AGENTS].sort();

      // THEN - Every agent file should be in exactly one tier
      const sortedFiles = [...allAgentFiles].sort();
      expect(sortedFiles).toEqual(allCategorized);
    });

    it('should only use valid model values (opus, sonnet, haiku)', () => {
      // GIVEN - All agent .md files
      const allAgentFiles = readdirSync(AGENTS_DIR).filter(
        (f) => f.endsWith('.md') && !f.startsWith('_')
      );

      // WHEN - I check model values in all agents
      for (const file of allAgentFiles) {
        const frontmatter = parseFrontmatter(join(AGENTS_DIR, file));

        // THEN - If model is present, it must be a valid value
        if ('model' in frontmatter) {
          expect(VALID_MODEL_VALUES).toContain(frontmatter.model);
        }
      }
    });

    it('should allow model and model_routing to coexist', () => {
      // GIVEN - Agents that have both model and model_routing
      const allAgentFiles = readdirSync(AGENTS_DIR).filter(
        (f) => f.endsWith('.md') && !f.startsWith('_')
      );

      // WHEN - I find agents with model_routing: true
      for (const file of allAgentFiles) {
        const frontmatter = parseFrontmatter(join(AGENTS_DIR, file));

        // THEN - model_routing should always be boolean true if present
        if ('model_routing' in frontmatter) {
          expect(frontmatter.model_routing).toBe(true);
        }
      }
    });
  });
});
