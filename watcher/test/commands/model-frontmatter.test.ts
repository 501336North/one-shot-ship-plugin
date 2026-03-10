import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * @behavior Command .md files have correct model: frontmatter for cost/quality optimization
 * @user-story As a plugin user, I want commands to use the optimal Claude model
 *             so that strategic commands get best reasoning and routine commands save cost
 */

const COMMANDS_DIR = join(__dirname, '..', '..', '..', 'commands');

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

// Commands that MUST use Opus — strategic thinking, multi-perspective analysis
const OPUS_COMMANDS = ['plan', 'ideate', 'review', 'audit', 'postmortem', 'chaos'];

// Commands that SHOULD use Haiku — display, config, routine operations
const HAIKU_COMMANDS = [
  'changelog',
  'status',
  'legend',
  'settings',
  'login',
  'models',
  'pause',
  'resume',
  'queue',
  'watcher',
  'telegram',
  'workflows',
  'oss',
  'oss-audio',
  'docs',
  'release',
];

// Commands that inherit parent model (no model field)
const INHERIT_COMMANDS = [
  'a11y',
  'acceptance',
  'adr',
  'api-design',
  'bench',
  'build',
  'contract',
  'cost',
  'data-model',
  'debug',
  'deploy',
  'design-review',
  'experiment',
  'feature-flag',
  'green',
  'incident',
  'integration',
  'iterate',
  'license',
  'load',
  'mock',
  'monitor',
  'onboard',
  'oss-custom',
  'privacy',
  'quick',
  'red',
  'refactor',
  'requirements',
  'retro',
  'rollback',
  'ship',
  'smoke',
  'stage',
  'test',
  'tech-debt',
  'trace',
  'trust',
  'verify',
  'visual-qa',
  'webhook',
];

const VALID_MODEL_VALUES = ['opus', 'sonnet', 'haiku'];

describe('Command Model Frontmatter (Acceptance)', () => {
  describe('Opus commands — force upgrade for strategic reasoning', () => {
    it.each(OPUS_COMMANDS)(
      'should have model: opus in frontmatter for %s',
      (commandName) => {
        // GIVEN - A command .md file that handles strategic analysis
        const filePath = join(COMMANDS_DIR, `${commandName}.md`);

        // WHEN - I parse its frontmatter
        const frontmatter = parseFrontmatter(filePath);

        // THEN - It should specify model: opus
        expect(frontmatter.model).toBe('opus');
      }
    );
  });

  describe('Haiku commands — force downgrade for routine tasks', () => {
    it.each(HAIKU_COMMANDS)(
      'should have model: haiku in frontmatter for %s',
      (commandName) => {
        // GIVEN - A command .md file that handles routine/display tasks
        const filePath = join(COMMANDS_DIR, `${commandName}.md`);

        // WHEN - I parse its frontmatter
        const frontmatter = parseFrontmatter(filePath);

        // THEN - It should specify model: haiku
        expect(frontmatter.model).toBe('haiku');
      }
    );
  });

  describe('Inherit-parent commands — no model field', () => {
    it.each(INHERIT_COMMANDS)(
      'should NOT have model field in frontmatter for %s',
      (commandName) => {
        // GIVEN - A command .md file that should inherit parent model
        const filePath = join(COMMANDS_DIR, `${commandName}.md`);

        // WHEN - I parse its frontmatter
        const frontmatter = parseFrontmatter(filePath);

        // THEN - It should NOT have a model field
        expect(frontmatter).not.toHaveProperty('model');
      }
    );
  });

  describe('Completeness and validity', () => {
    it('should account for all command .md files across the three tiers', () => {
      // GIVEN - All command .md files
      const allCommandFiles = readdirSync(COMMANDS_DIR)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace('.md', ''));

      // WHEN - I combine all three tier lists
      const allCategorized = [...OPUS_COMMANDS, ...HAIKU_COMMANDS, ...INHERIT_COMMANDS].sort();

      // THEN - Every command file should be in exactly one tier
      const sortedFiles = [...allCommandFiles].sort();
      expect(sortedFiles).toEqual(allCategorized);
    });

    it('should only use valid model values (opus, sonnet, haiku)', () => {
      // GIVEN - All command .md files
      const allCommandFiles = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.md'));

      // WHEN - I check model values in all commands
      for (const file of allCommandFiles) {
        const frontmatter = parseFrontmatter(join(COMMANDS_DIR, file));

        // THEN - If model is present, it must be a valid value
        if ('model' in frontmatter) {
          expect(VALID_MODEL_VALUES).toContain(frontmatter.model);
        }
      }
    });
  });
});
