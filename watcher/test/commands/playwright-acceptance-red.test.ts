/**
 * @behavior /oss:acceptance and /oss:red should support Playwright test generation
 * @acceptance-criteria Tasks 2.3 & 2.6 - Playwright for acceptance and red phase
 * @business-rule Generate Playwright tests for UI features
 * @boundary Command Configuration
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Playwright Acceptance & Red Phase', () => {
  const commandsDir = path.resolve(__dirname, '../../../commands');

  describe('/oss:acceptance Command', () => {
    const acceptanceMdPath = path.join(commandsDir, 'acceptance.md');

    it('should mention Playwright for UI acceptance tests', () => {
      const content = fs.readFileSync(acceptanceMdPath, 'utf-8');
      expect(content).toContain('Playwright');
    });

    it('should mention Given/When/Then format', () => {
      const content = fs.readFileSync(acceptanceMdPath, 'utf-8');
      const hasGWT =
        content.includes('Given') ||
        content.includes('When') ||
        content.includes('Then');
      expect(hasGWT).toBe(true);
    });

    it('should mention data-testid selectors', () => {
      const content = fs.readFileSync(acceptanceMdPath, 'utf-8');
      expect(content).toContain('data-testid');
    });
  });

  describe('/oss:red Command', () => {
    const redMdPath = path.join(commandsDir, 'red.md');

    it('should mention Playwright for UI features', () => {
      const content = fs.readFileSync(redMdPath, 'utf-8');
      expect(content).toContain('Playwright');
    });

    it('should list UI detection keywords', () => {
      const content = fs.readFileSync(redMdPath, 'utf-8');
      const hasUIKeywords =
        content.includes('page') ||
        content.includes('form') ||
        content.includes('button') ||
        content.includes('UI');
      expect(hasUIKeywords).toBe(true);
    });
  });
});
