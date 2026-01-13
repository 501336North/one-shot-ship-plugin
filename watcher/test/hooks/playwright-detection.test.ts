/**
 * @behavior OSS should detect Playwright configuration in user projects
 * @acceptance-criteria Task 2.1 - Playwright Detection Utility
 * @business-rule Enable Playwright-aware testing workflows
 * @boundary Hook Script
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('Playwright Detection Utility', () => {
  const hooksDir = path.resolve(__dirname, '../../../hooks');
  const scriptPath = path.join(hooksDir, 'oss-detect-playwright.sh');

  describe('Script Existence', () => {
    it('should have oss-detect-playwright.sh in hooks directory', () => {
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    it('should be executable', () => {
      const stats = fs.statSync(scriptPath);
      const isExecutable = (stats.mode & parseInt('111', 8)) !== 0;
      expect(isExecutable).toBe(true);
    });
  });

  describe('Detection Logic', () => {
    const testDir = path.join(__dirname, 'test-playwright-detection');

    beforeAll(() => {
      // Create test directory
      fs.mkdirSync(testDir, { recursive: true });
    });

    afterAll(() => {
      // Cleanup test directory
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should return JSON output with detected field', () => {
      // Create minimal package.json without playwright
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({ name: 'test', devDependencies: {} })
      );

      const output = execSync(`cd ${testDir} && bash ${scriptPath}`, {
        encoding: 'utf-8',
      });

      const result = JSON.parse(output.trim());
      expect(result).toHaveProperty('detected');
      expect(typeof result.detected).toBe('boolean');
    });

    it('should detect Playwright when @playwright/test is in devDependencies', () => {
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          devDependencies: { '@playwright/test': '^1.40.0' },
        })
      );

      const output = execSync(`cd ${testDir} && bash ${scriptPath}`, {
        encoding: 'utf-8',
      });

      const result = JSON.parse(output.trim());
      expect(result.detected).toBe(true);
    });

    it('should return detected: false when no Playwright', () => {
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({ name: 'test', devDependencies: {} })
      );

      const output = execSync(`cd ${testDir} && bash ${scriptPath}`, {
        encoding: 'utf-8',
      });

      const result = JSON.parse(output.trim());
      expect(result.detected).toBe(false);
    });
  });
});
