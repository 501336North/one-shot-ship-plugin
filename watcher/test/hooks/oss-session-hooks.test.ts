/**
 * @behavior Session hooks manage project tracking via ~/.oss/current-project
 * @acceptance-criteria Session start writes current project path, session end clears it
 * @business-rule Multi-project support requires knowing which project is active
 * @boundary Shell hooks (oss-session-start.sh, oss-session-end.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Session Hooks - Project Tracking', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const sessionStartScript = path.join(hooksDir, 'oss-session-start.sh');
  const sessionEndScript = path.join(hooksDir, 'oss-session-end.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const currentProjectFile = path.join(ossDir, 'current-project');
  const testProjectDir = path.join(os.tmpdir(), `oss-test-project-${Date.now()}`);

  // Save original state
  let originalCurrentProject: string | null = null;

  beforeEach(() => {
    // Save original current-project if it exists
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }

    // Create test project directory with minimal git setup
    fs.mkdirSync(testProjectDir, { recursive: true });

    // Initialize as git repo (required by session-end.sh)
    try {
      execSync('git init', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: testProjectDir, stdio: 'ignore' });
    } catch {
      // Git init might fail in some environments
    }

    // Ensure ~/.oss exists
    fs.mkdirSync(ossDir, { recursive: true });

    // Clear current-project file
    if (fs.existsSync(currentProjectFile)) {
      fs.unlinkSync(currentProjectFile);
    }
  });

  afterEach(() => {
    // Restore original current-project
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.unlinkSync(currentProjectFile);
    }

    // Clean up test project
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  describe('oss-session-start.sh', () => {
    /**
     * @behavior Session start writes current project path to ~/.oss/current-project
     * @acceptance-criteria After session start, current-project contains absolute project path
     */
    it('should write CLAUDE_PROJECT_DIR to ~/.oss/current-project', () => {
      // GIVEN: No current-project file exists
      expect(fs.existsSync(currentProjectFile)).toBe(false);

      // WHEN: Running session start with CLAUDE_PROJECT_DIR set
      try {
        execSync(`bash "${sessionStartScript}"`, {
          timeout: 30000,
          encoding: 'utf-8',
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: testProjectDir,
            CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
          },
          cwd: testProjectDir,
        });
      } catch {
        // Script may exit non-zero for various reasons (missing config, etc.)
        // We only care about the current-project file
      }

      // THEN: current-project file should contain the project path
      expect(fs.existsSync(currentProjectFile)).toBe(true);
      const projectPath = fs.readFileSync(currentProjectFile, 'utf-8').trim();
      expect(projectPath).toBe(testProjectDir);
    });

    /**
     * @behavior Session start copies status line script to ~/.oss/
     * @acceptance-criteria After session start, ~/.oss/oss-statusline.sh matches plugin version
     */
    it('should copy status line script to ~/.oss/', () => {
      const statusLineTarget = path.join(ossDir, 'oss-statusline.sh');
      const statusLineSource = path.join(hooksDir, 'oss-statusline.sh');

      // GIVEN: Status line script exists in plugin hooks
      expect(fs.existsSync(statusLineSource)).toBe(true);

      // Clear any existing status line in ~/.oss to verify it gets copied
      if (fs.existsSync(statusLineTarget)) {
        fs.unlinkSync(statusLineTarget);
      }

      // WHEN: Running session start
      try {
        execSync(`bash "${sessionStartScript}"`, {
          timeout: 30000,
          encoding: 'utf-8',
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: testProjectDir,
            CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
          },
          cwd: testProjectDir,
        });
      } catch {
        // Ignore exit code
      }

      // THEN: Status line script should exist in ~/.oss/
      expect(fs.existsSync(statusLineTarget)).toBe(true);

      // THEN: Content should match the plugin version
      const sourceContent = fs.readFileSync(statusLineSource, 'utf-8');
      const targetContent = fs.readFileSync(statusLineTarget, 'utf-8');
      expect(targetContent).toBe(sourceContent);
    });

    /**
     * @behavior Session start overwrites existing current-project
     * @acceptance-criteria New session in different project updates the file
     */
    it('should overwrite existing current-project with new project path', () => {
      // GIVEN: current-project file exists with old path
      const oldProject = '/old/project/path';
      fs.writeFileSync(currentProjectFile, oldProject);

      // WHEN: Running session start with new CLAUDE_PROJECT_DIR
      try {
        execSync(`bash "${sessionStartScript}"`, {
          timeout: 30000,
          encoding: 'utf-8',
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: testProjectDir,
            CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
          },
          cwd: testProjectDir,
        });
      } catch {
        // Ignore exit code
      }

      // THEN: current-project should have new path
      const projectPath = fs.readFileSync(currentProjectFile, 'utf-8').trim();
      expect(projectPath).toBe(testProjectDir);
    });
  });

  describe('oss-session-end.sh', () => {
    /**
     * @behavior Session end clears current-project file
     * @acceptance-criteria After session end, current-project is empty
     */
    it('should clear ~/.oss/current-project on session end', () => {
      // GIVEN: current-project file contains a project path
      fs.writeFileSync(currentProjectFile, testProjectDir);
      expect(fs.readFileSync(currentProjectFile, 'utf-8').trim()).toBe(testProjectDir);

      // WHEN: Running session end
      try {
        execSync(`bash "${sessionEndScript}"`, {
          timeout: 30000,
          encoding: 'utf-8',
          env: {
            ...process.env,
            CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
          },
          cwd: testProjectDir,
        });
      } catch {
        // Ignore exit code
      }

      // THEN: current-project should be empty (or contain empty string)
      if (fs.existsSync(currentProjectFile)) {
        const content = fs.readFileSync(currentProjectFile, 'utf-8').trim();
        expect(content).toBe('');
      }
      // File being deleted is also acceptable
    });
  });
});
