/**
 * @behavior oss-log.sh writes health workflow state to project .oss/ when current-project set
 * @acceptance-criteria Health state updates go to project directory
 * @business-rule Multi-project support requires logging to correct project
 * @boundary Shell script (oss-log.sh workflow commands)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-log.sh - Project Health State', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const logScript = path.join(hooksDir, 'oss-log.sh');
  const ossDir = path.join(os.homedir(), '.oss');
  const currentProjectFile = path.join(ossDir, 'current-project');
  const globalHealthStateFile = path.join(ossDir, 'health-workflow-state.json');
  const testProjectDir = path.join(os.tmpdir(), `oss-log-project-test-${Date.now()}`);
  const projectOssDir = path.join(testProjectDir, '.oss');
  const projectHealthStateFile = path.join(projectOssDir, 'health-workflow-state.json');

  // Save original state
  let originalCurrentProject: string | null = null;
  let originalGlobalHealthState: string | null = null;

  beforeEach(() => {
    // Save original files
    if (fs.existsSync(currentProjectFile)) {
      originalCurrentProject = fs.readFileSync(currentProjectFile, 'utf-8');
    }
    if (fs.existsSync(globalHealthStateFile)) {
      originalGlobalHealthState = fs.readFileSync(globalHealthStateFile, 'utf-8');
    }

    // Create test project directory with .oss
    fs.mkdirSync(projectOssDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original files
    if (originalCurrentProject !== null) {
      fs.writeFileSync(currentProjectFile, originalCurrentProject);
    } else if (fs.existsSync(currentProjectFile)) {
      fs.unlinkSync(currentProjectFile);
    }

    if (originalGlobalHealthState !== null) {
      fs.writeFileSync(globalHealthStateFile, originalGlobalHealthState);
    }

    // Clean up test project
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior oss-log.sh workflow set-feature writes to project health state
   * @acceptance-criteria Feature name written to project .oss/health-workflow-state.json
   */
  it('should write health state to project .oss when current-project set', () => {
    // GIVEN: current-project points to test project
    fs.writeFileSync(currentProjectFile, testProjectDir);

    // WHEN: Running log script with workflow set-feature
    try {
      execSync(`bash "${logScript}" workflow set-feature test-feature`, {
        timeout: 10000,
        encoding: 'utf-8',
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
        },
      });
    } catch {
      // Ignore exit code
    }

    // THEN: Project health-workflow-state.json should have the feature
    expect(fs.existsSync(projectHealthStateFile)).toBe(true);
    const state = JSON.parse(fs.readFileSync(projectHealthStateFile, 'utf-8'));
    expect(state.currentFeature).toBe('test-feature');
  });

  /**
   * @behavior oss-log.sh falls back to global when no current-project
   * @acceptance-criteria Uses ~/.oss when current-project is empty
   */
  it('should fall back to global when current-project empty', () => {
    // GIVEN: current-project is empty
    fs.writeFileSync(currentProjectFile, '');

    // WHEN: Running log script with workflow set-feature
    try {
      execSync(`bash "${logScript}" workflow set-feature global-feature`, {
        timeout: 10000,
        encoding: 'utf-8',
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
        },
      });
    } catch {
      // Ignore exit code
    }

    // THEN: Global health-workflow-state.json should have the feature
    expect(fs.existsSync(globalHealthStateFile)).toBe(true);
    const state = JSON.parse(fs.readFileSync(globalHealthStateFile, 'utf-8'));
    expect(state.currentFeature).toBe('global-feature');
  });
});
