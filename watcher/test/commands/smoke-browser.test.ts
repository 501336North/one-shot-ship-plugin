/**
 * @behavior /oss:smoke should support browser-based smoke testing
 * @acceptance-criteria Task 2.5 - Enhanced /oss:smoke for Browser Testing
 * @business-rule Verify critical user flows after deployment
 * @boundary Command Configuration
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Smoke Browser Testing', () => {
  const commandsDir = path.resolve(__dirname, '../../../commands');
  const smokeMdPath = path.join(commandsDir, 'smoke.md');

  describe('/oss:smoke Command', () => {
    it('should mention browser testing capability', () => {
      const content = fs.readFileSync(smokeMdPath, 'utf-8');
      const hasBrowserMention =
        content.includes('browser') || content.includes('Playwright');
      expect(hasBrowserMention).toBe(true);
    });

    it('should support --browser flag', () => {
      const content = fs.readFileSync(smokeMdPath, 'utf-8');
      expect(content).toContain('--browser');
    });

    it('should support --url flag for target URL', () => {
      const content = fs.readFileSync(smokeMdPath, 'utf-8');
      expect(content).toContain('--url');
    });

    it('should mention screenshot on failure', () => {
      const content = fs.readFileSync(smokeMdPath, 'utf-8');
      const hasScreenshotMention =
        content.includes('screenshot') || content.includes('Screenshot');
      expect(hasScreenshotMention).toBe(true);
    });
  });
});
