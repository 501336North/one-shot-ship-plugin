/**
 * @behavior Dev docs path resolution prioritizes project-local over global
 * @acceptance-criteria Project .oss/dev/active/ takes precedence over ~/.oss/dev/active/
 * @business-rule Multi-project support requires isolated dev docs per project
 * @boundary Service (DevDocsPathResolver)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Import the function we'll create
import { getDevDocsPath, getActiveFeaturePath, getCompletedPath } from '../../src/services/dev-docs-path';

describe('DevDocsPathResolver', () => {
  const testProjectDir = path.join(os.tmpdir(), `dev-docs-test-${Date.now()}`);
  const globalOssDir = path.join(os.homedir(), '.oss');

  // Save original state
  let originalGlobalDevActive: boolean;

  beforeEach(() => {
    // Create test project directory
    fs.mkdirSync(testProjectDir, { recursive: true });

    // Track if global dev/active exists
    originalGlobalDevActive = fs.existsSync(path.join(globalOssDir, 'dev', 'active'));
  });

  afterEach(() => {
    // Clean up test project
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  describe('getDevDocsPath', () => {
    /**
     * @behavior Returns project .oss/dev/ when it exists
     * @acceptance-criteria Project-local path takes priority over global
     */
    it('should return project .oss/dev/ when it exists', () => {
      // GIVEN: Project has .oss/dev/active/ directory
      const projectOssDevActive = path.join(testProjectDir, '.oss', 'dev', 'active');
      fs.mkdirSync(projectOssDevActive, { recursive: true });

      // WHEN: Getting dev docs path for the project
      const result = getDevDocsPath(testProjectDir);

      // THEN: Should return project-local path
      expect(result).toBe(path.join(testProjectDir, '.oss', 'dev'));
    });

    /**
     * @behavior Returns project dev/ when .oss/dev/ doesn't exist but dev/ does
     * @acceptance-criteria Supports existing dev/ pattern (backward compatibility)
     */
    it('should return project dev/ when .oss/dev/ does not exist but dev/ does', () => {
      // GIVEN: Project has dev/active/ but NOT .oss/dev/active/
      const projectDevActive = path.join(testProjectDir, 'dev', 'active');
      fs.mkdirSync(projectDevActive, { recursive: true });

      // WHEN: Getting dev docs path for the project
      const result = getDevDocsPath(testProjectDir);

      // THEN: Should return project dev/ path
      expect(result).toBe(path.join(testProjectDir, 'dev'));
    });

    /**
     * @behavior Falls back to global ~/.oss/dev/ when project has neither
     * @acceptance-criteria Global fallback for projects without local dev docs
     */
    it('should fall back to global ~/.oss/dev/ when project has no dev docs', () => {
      // GIVEN: Project has NO dev docs directories
      // (testProjectDir is empty)

      // WHEN: Getting dev docs path for the project
      const result = getDevDocsPath(testProjectDir);

      // THEN: Should return global path
      expect(result).toBe(path.join(os.homedir(), '.oss', 'dev'));
    });

    /**
     * @behavior Prioritizes .oss/dev/ over dev/ when both exist
     * @acceptance-criteria .oss/dev/ is the canonical location
     */
    it('should prioritize .oss/dev/ over dev/ when both exist', () => {
      // GIVEN: Project has BOTH .oss/dev/active/ AND dev/active/
      const projectOssDevActive = path.join(testProjectDir, '.oss', 'dev', 'active');
      const projectDevActive = path.join(testProjectDir, 'dev', 'active');
      fs.mkdirSync(projectOssDevActive, { recursive: true });
      fs.mkdirSync(projectDevActive, { recursive: true });

      // WHEN: Getting dev docs path for the project
      const result = getDevDocsPath(testProjectDir);

      // THEN: Should return .oss/dev/ (canonical location)
      expect(result).toBe(path.join(testProjectDir, '.oss', 'dev'));
    });
  });

  describe('getActiveFeaturePath', () => {
    /**
     * @behavior Returns path to specific feature's active docs
     * @acceptance-criteria Feature path is under active/ subdirectory
     */
    it('should return path to feature active docs in project', () => {
      // GIVEN: Project has .oss/dev/active/
      const projectOssDevActive = path.join(testProjectDir, '.oss', 'dev', 'active');
      fs.mkdirSync(projectOssDevActive, { recursive: true });

      // WHEN: Getting feature path
      const result = getActiveFeaturePath(testProjectDir, 'my-feature');

      // THEN: Should return feature path under active/
      expect(result).toBe(path.join(testProjectDir, '.oss', 'dev', 'active', 'my-feature'));
    });
  });

  describe('getCompletedPath', () => {
    /**
     * @behavior Returns path to completed features directory
     * @acceptance-criteria Completed path is sibling to active/
     */
    it('should return path to completed directory in project', () => {
      // GIVEN: Project has .oss/dev/active/
      const projectOssDevActive = path.join(testProjectDir, '.oss', 'dev', 'active');
      fs.mkdirSync(projectOssDevActive, { recursive: true });

      // WHEN: Getting completed path
      const result = getCompletedPath(testProjectDir);

      // THEN: Should return completed/ path
      expect(result).toBe(path.join(testProjectDir, '.oss', 'dev', 'completed'));
    });
  });
});
