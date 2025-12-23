/**
 * @behavior Pre/post command hooks automatically update workflow state
 * @acceptance-criteria When /oss:plan starts, currentCommand="plan" is set automatically
 * @business-rule Workflow state tracks which command is running for status line
 * @boundary Shell script (oss-workflow-auto.sh)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('oss-workflow-auto.sh - Automatic Workflow State Updates', () => {
  const hooksDir = path.join(__dirname, '../../../hooks');
  const hookScript = path.join(hooksDir, 'oss-workflow-auto.sh');
  const testProjectDir = path.join(os.tmpdir(), `oss-auto-hook-${Date.now()}`);
  const projectOssDir = path.join(testProjectDir, '.oss');
  const workflowStateFile = path.join(projectOssDir, 'workflow-state.json');

  beforeEach(() => {
    // Create test project directory
    fs.mkdirSync(projectOssDir, { recursive: true });
  });

  afterEach(() => {
    // Cleanup
    fs.rmSync(testProjectDir, { recursive: true, force: true });
  });

  const runHook = (event: string, command: string): string => {
    try {
      // Pass project directory as third argument for project-local state
      return execSync(`bash "${hookScript}" ${event} ${command} "${testProjectDir}"`, {
        timeout: 10000,
        encoding: 'utf-8',
        cwd: testProjectDir,
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: path.join(hooksDir, '..'),
          HOME: os.homedir(),
        },
      });
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; message?: string };
      return execError.stdout || execError.stderr || execError.message || '';
    }
  };

  const getState = (): Record<string, unknown> => {
    if (fs.existsSync(workflowStateFile)) {
      return JSON.parse(fs.readFileSync(workflowStateFile, 'utf-8'));
    }
    return {};
  };

  describe('Pre-command hook (command start)', () => {
    /**
     * @behavior Pre hook sets currentCommand when command starts
     * @acceptance-criteria After 'pre plan', state.currentCommand === 'plan'
     */
    it('should set currentCommand on pre event', () => {
      // GIVEN: No workflow state exists yet

      // WHEN: Hook is called with pre and command name
      runHook('pre', 'plan');

      // THEN: Workflow state has currentCommand=plan
      const state = getState();
      expect(state.currentCommand).toBe('plan');
    });

    /**
     * @behavior Pre hook sets supervisor to watching
     * @acceptance-criteria After 'pre build', state.supervisor === 'watching'
     */
    it('should set supervisor to watching on pre event', () => {
      // WHEN: Hook is called with pre and command name
      runHook('pre', 'build');

      // THEN: Workflow state has supervisor=watching
      const state = getState();
      expect(state.supervisor).toBe('watching');
    });
  });

  describe('Post-command hook (command complete)', () => {
    /**
     * @behavior Post hook sets nextCommand based on workflow progression
     * @acceptance-criteria After 'post ideate', state.nextCommand === 'plan'
     */
    it('should set nextCommand to plan after ideate completes', () => {
      // GIVEN: Pre hook was called (simulating ideate start)
      runHook('pre', 'ideate');

      // WHEN: Post hook is called (ideate complete)
      runHook('post', 'ideate');

      // THEN: nextCommand is set to 'plan'
      const state = getState();
      expect(state.nextCommand).toBe('plan');
    });

    /**
     * @behavior Post hook sets nextCommand to build after plan completes
     * @acceptance-criteria After 'post plan', state.nextCommand === 'build'
     */
    it('should set nextCommand to build after plan completes', () => {
      runHook('pre', 'plan');
      runHook('post', 'plan');

      const state = getState();
      expect(state.nextCommand).toBe('build');
    });

    /**
     * @behavior Post hook sets nextCommand to ship after build completes
     * @acceptance-criteria After 'post build', state.nextCommand === 'ship'
     */
    it('should set nextCommand to ship after build completes', () => {
      runHook('pre', 'build');
      runHook('post', 'build');

      const state = getState();
      expect(state.nextCommand).toBe('ship');
    });

    /**
     * @behavior Post hook clears nextCommand after ship completes
     * @acceptance-criteria After 'post ship', state.nextCommand === null
     */
    it('should clear nextCommand after ship completes', () => {
      runHook('pre', 'ship');
      runHook('post', 'ship');

      const state = getState();
      expect(state.nextCommand).toBeNull();
    });

    /**
     * @behavior Post hook clears currentCommand
     * @acceptance-criteria After 'post plan', state.currentCommand is undefined
     */
    it('should clear currentCommand on post event', () => {
      // GIVEN: Pre hook set currentCommand
      runHook('pre', 'plan');
      let state = getState();
      expect(state.currentCommand).toBe('plan');

      // WHEN: Post hook is called
      runHook('post', 'plan');

      // THEN: currentCommand is cleared
      state = getState();
      expect(state.currentCommand).toBeUndefined();
    });
  });
});
