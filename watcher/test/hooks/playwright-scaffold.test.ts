/**
 * @behavior OSS should scaffold Playwright setup for web projects
 * @acceptance-criteria Task 2.2 - Playwright Setup Scaffolding
 * @business-rule Easy onboarding for Playwright testing
 * @boundary Hook Script
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Playwright Scaffold Utility', () => {
  const hooksDir = path.resolve(__dirname, '../../../hooks');
  const scriptPath = path.join(hooksDir, 'oss-scaffold-playwright.sh');

  describe('Script Existence', () => {
    it('should have oss-scaffold-playwright.sh in hooks directory', () => {
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    it('should be executable', () => {
      const stats = fs.statSync(scriptPath);
      const isExecutable = (stats.mode & parseInt('111', 8)) !== 0;
      expect(isExecutable).toBe(true);
    });
  });

  describe('Script Content', () => {
    it('should include npm init playwright command', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('playwright');
    });

    it('should check for existing configuration before scaffolding', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      // Should check if playwright.config already exists
      const checksExisting =
        content.includes('playwright.config') ||
        content.includes('already') ||
        content.includes('exists');
      expect(checksExisting).toBe(true);
    });
  });
});
