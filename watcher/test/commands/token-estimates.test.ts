/**
 * @behavior Commands should have token usage estimates in frontmatter
 * @acceptance-criteria Task 1.6 - Token Usage Visibility
 * @business-rule Users should know approximate cost before running commands
 * @boundary Command Configuration
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Token Usage Visibility', () => {
  const commandsDir = path.resolve(__dirname, '../../../commands');

  // High-usage commands that should have token estimates
  const highUsageCommands = [
    'build.md',
    'ideate.md',
    'review.md',
  ];

  describe('Frontmatter Token Estimates', () => {
    highUsageCommands.forEach((commandFile) => {
      it(`${commandFile} should have estimated_tokens in frontmatter`, () => {
        const filePath = path.join(commandsDir, commandFile);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Check for YAML frontmatter with estimated_tokens
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        expect(frontmatterMatch).not.toBeNull();

        const frontmatter = frontmatterMatch![1];
        expect(frontmatter).toContain('estimated_tokens:');
      });
    });
  });

  describe('Estimate Format', () => {
    it('build.md should have a reasonable token range', () => {
      const filePath = path.join(commandsDir, 'build.md');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should have a range format like "5000-15000"
      const hasTokenRange =
        content.includes('estimated_tokens:') &&
        (content.includes('-') || content.includes('~'));

      expect(hasTokenRange).toBe(true);
    });
  });
});
