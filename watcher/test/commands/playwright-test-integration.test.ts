/**
 * @behavior /oss:test should detect and run Playwright tests
 * @acceptance-criteria Task 2.4 - Enhanced /oss:test for Playwright
 * @business-rule Run Playwright E2E tests alongside unit tests
 * @boundary Command Configuration
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Playwright Test Integration', () => {
  const commandsDir = path.resolve(__dirname, '../../../commands');
  const testMdPath = path.join(commandsDir, 'test.md');

  describe('/oss:test Command', () => {
    it('should mention Playwright detection', () => {
      const content = fs.readFileSync(testMdPath, 'utf-8');

      const mentionsPlaywrightDetection =
        content.includes('Playwright') ||
        content.includes('playwright');

      expect(mentionsPlaywrightDetection).toBe(true);
    });

    it('should include oss-detect-playwright.sh hook', () => {
      const content = fs.readFileSync(testMdPath, 'utf-8');

      const hasDetectionHook =
        content.includes('oss-detect-playwright') ||
        content.includes('detect-playwright');

      expect(hasDetectionHook).toBe(true);
    });

    it('should have npx playwright test command', () => {
      const content = fs.readFileSync(testMdPath, 'utf-8');

      const hasPlaywrightCommand =
        content.includes('npx playwright test') ||
        content.includes('playwright test');

      expect(hasPlaywrightCommand).toBe(true);
    });

    it('should mention browser coverage reporting', () => {
      const content = fs.readFileSync(testMdPath, 'utf-8');

      const hasBrowserReporting =
        content.includes('Chromium') ||
        content.includes('Firefox') ||
        content.includes('WebKit') ||
        content.includes('browser');

      expect(hasBrowserReporting).toBe(true);
    });
  });
});
