import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * @behavior Skill .md files have correct model: frontmatter for cost/quality optimization
 * @user-story As a plugin user, I want skills to use the optimal Claude model
 *             so that critical skills get best reasoning and routine skills save cost
 */

const SKILLS_DIR = join(__dirname, '..', '..', '..', 'skills');

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

// Skills that MUST use Opus — mirrors opus agents/commands + standalone security
const OPUS_SKILLS = [
  'architecture-auditor',
  'backend-architect',
  'cloud-architect',
  'code-reviewer',
  'debugger',
  'incident-responder',
  'performance-auditor',
  'security-auditor',
  'plan',
  'ideate',
  'security-audit',
  'owasp-top10',
];

// Skills that SHOULD use Haiku — mirrors haiku agents/commands + standalone doc generation
const HAIKU_SKILLS = [
  'dependency-analyzer',
  'docs-architect',
  'git-workflow-manager',
  'release-manager',
  'release',
  'create-dev-docs',
];

// Skills that inherit parent model (no model field)
const INHERIT_SKILLS = [
  'ai-engineer',
  'build',
  'data-engineer',
  'database-admin',
  'database-optimizer',
  'deploy-production',
  'deploy-staging',
  'deployment-engineer',
  'devops-troubleshooter',
  'e2e-testing',
  'emergency-rollback',
  'flutter-expert',
  'frontend-developer',
  'golang-pro',
  'graphql-architect',
  'ios-developer',
  'java-pro',
  'london-tdd',
  'ml-engineer',
  'mobile-developer',
  'mocking-patterns',
  'monitor',
  'nextjs-developer',
  'performance-benchmark',
  'performance-engineer',
  'python-pro',
  'qa-expert',
  'react-patterns',
  'react-specialist',
  'refactoring-specialist',
  'rest-best-practices',
  'ship',
  'sre-engineer',
  'swift-macos-expert',
  'test-automator',
  'test-engineer',
  'typescript-pro',
  'typescript-strict',
  'visionos-developer',
];

const VALID_MODEL_VALUES = ['opus', 'sonnet', 'haiku'];

describe('Skill Model Frontmatter (Acceptance)', () => {
  describe('Opus skills — force upgrade for critical reasoning', () => {
    it.each(OPUS_SKILLS)(
      'should have model: opus in frontmatter for %s',
      (skillName) => {
        // GIVEN - A skill .md file that handles critical reasoning
        const filePath = join(SKILLS_DIR, `${skillName}.md`);

        // WHEN - I parse its frontmatter
        const frontmatter = parseFrontmatter(filePath);

        // THEN - It should specify model: opus
        expect(frontmatter.model).toBe('opus');
      }
    );
  });

  describe('Haiku skills — force downgrade for mechanical tasks', () => {
    it.each(HAIKU_SKILLS)(
      'should have model: haiku in frontmatter for %s',
      (skillName) => {
        // GIVEN - A skill .md file that handles mechanical/routine tasks
        const filePath = join(SKILLS_DIR, `${skillName}.md`);

        // WHEN - I parse its frontmatter
        const frontmatter = parseFrontmatter(filePath);

        // THEN - It should specify model: haiku
        expect(frontmatter.model).toBe('haiku');
      }
    );
  });

  describe('Inherit-parent skills — no model field', () => {
    it.each(INHERIT_SKILLS)(
      'should NOT have model field in frontmatter for %s',
      (skillName) => {
        // GIVEN - A skill .md file that should inherit parent model
        const filePath = join(SKILLS_DIR, `${skillName}.md`);

        // WHEN - I parse its frontmatter
        const frontmatter = parseFrontmatter(filePath);

        // THEN - It should NOT have a model field
        expect(frontmatter).not.toHaveProperty('model');
      }
    );
  });

  describe('Completeness and validity', () => {
    it('should account for all skill .md files across the three tiers', () => {
      // GIVEN - All skill .md files
      const allSkillFiles = readdirSync(SKILLS_DIR)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace('.md', ''));

      // WHEN - I combine all three tier lists
      const allCategorized = [...OPUS_SKILLS, ...HAIKU_SKILLS, ...INHERIT_SKILLS].sort();

      // THEN - Every skill file should be in exactly one tier
      const sortedFiles = [...allSkillFiles].sort();
      expect(sortedFiles).toEqual(allCategorized);
    });

    it('should only use valid model values (opus, sonnet, haiku)', () => {
      // GIVEN - All skill .md files
      const allSkillFiles = readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md'));

      // WHEN - I check model values in all skills
      for (const file of allSkillFiles) {
        const frontmatter = parseFrontmatter(join(SKILLS_DIR, file));

        // THEN - If model is present, it must be a valid value
        if ('model' in frontmatter) {
          expect(VALID_MODEL_VALUES).toContain(frontmatter.model);
        }
      }
    });
  });
});
