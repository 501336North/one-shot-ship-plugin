/**
 * @behavior update-workflow-state CLI supports setCurrentCommand and clearCurrentCommand
 * @acceptance-criteria CLI can set and clear the current command being executed
 * @business-rule Status line needs to know what command is running
 * @boundary CLI (update-workflow-state.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('update-workflow-state CLI - Current Command', () => {
  const cliPath = path.join(__dirname, '../../dist/cli/update-workflow-state.js');
  const testProjectDir = path.join(os.tmpdir(), `oss-current-cmd-test-${Date.now()}`);
  const projectOssDir = path.join(testProjectDir, '.oss');
  const projectWorkflowFile = path.join(projectOssDir, 'workflow-state.json');

  beforeEach(() => {
    fs.mkdirSync(projectOssDir, { recursive: true });
    // Initialize empty state
    fs.writeFileSync(projectWorkflowFile, JSON.stringify({}));
  });

  afterEach(() => {
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  describe('setCurrentCommand', () => {
    /**
     * @behavior CLI sets currentCommand in workflow state
     * @acceptance-criteria State contains currentCommand field with specified value
     */
    it('should set currentCommand to specified value', () => {
      // WHEN: Running CLI with setCurrentCommand
      execSync(`node "${cliPath}" --project-dir "${testProjectDir}" setCurrentCommand plan`, {
        timeout: 10000,
        encoding: 'utf-8',
      });

      // THEN: State should have currentCommand=plan
      const state = JSON.parse(fs.readFileSync(projectWorkflowFile, 'utf-8'));
      expect(state.currentCommand).toBe('plan');
    });

    /**
     * @behavior CLI overwrites existing currentCommand
     * @acceptance-criteria New value replaces old value
     */
    it('should overwrite existing currentCommand', () => {
      // GIVEN: Existing currentCommand
      fs.writeFileSync(projectWorkflowFile, JSON.stringify({ currentCommand: 'plan' }));

      // WHEN: Setting new currentCommand
      execSync(`node "${cliPath}" --project-dir "${testProjectDir}" setCurrentCommand build`, {
        timeout: 10000,
        encoding: 'utf-8',
      });

      // THEN: State should have new value
      const state = JSON.parse(fs.readFileSync(projectWorkflowFile, 'utf-8'));
      expect(state.currentCommand).toBe('build');
    });
  });

  describe('clearCurrentCommand', () => {
    /**
     * @behavior CLI removes currentCommand from state
     * @acceptance-criteria State no longer contains currentCommand field
     */
    it('should remove currentCommand from state', () => {
      // GIVEN: Existing currentCommand
      fs.writeFileSync(projectWorkflowFile, JSON.stringify({ currentCommand: 'build' }));

      // WHEN: Running clearCurrentCommand
      execSync(`node "${cliPath}" --project-dir "${testProjectDir}" clearCurrentCommand`, {
        timeout: 10000,
        encoding: 'utf-8',
      });

      // THEN: State should not have currentCommand
      const state = JSON.parse(fs.readFileSync(projectWorkflowFile, 'utf-8'));
      expect(state.currentCommand).toBeUndefined();
    });

    /**
     * @behavior CLI handles clearing when no currentCommand exists
     * @acceptance-criteria No error when clearing non-existent field
     */
    it('should handle clearing non-existent currentCommand', () => {
      // GIVEN: No currentCommand in state
      fs.writeFileSync(projectWorkflowFile, JSON.stringify({}));

      // WHEN: Running clearCurrentCommand
      expect(() => {
        execSync(`node "${cliPath}" --project-dir "${testProjectDir}" clearCurrentCommand`, {
          timeout: 10000,
          encoding: 'utf-8',
        });
      }).not.toThrow();

      // THEN: State should still not have currentCommand
      const state = JSON.parse(fs.readFileSync(projectWorkflowFile, 'utf-8'));
      expect(state.currentCommand).toBeUndefined();
    });
  });

  describe('setNextCommand', () => {
    /**
     * @behavior CLI sets nextCommand in workflow state
     * @acceptance-criteria State contains nextCommand field with specified value
     */
    it('should set nextCommand to specified value', () => {
      // WHEN: Running CLI with setNextCommand
      execSync(`node "${cliPath}" --project-dir "${testProjectDir}" setNextCommand build`, {
        timeout: 10000,
        encoding: 'utf-8',
      });

      // THEN: State should have nextCommand=build
      const state = JSON.parse(fs.readFileSync(projectWorkflowFile, 'utf-8'));
      expect(state.nextCommand).toBe('build');
    });
  });

  describe('clearNextCommand', () => {
    /**
     * @behavior CLI clears nextCommand (sets to null)
     * @acceptance-criteria State has nextCommand=null after clearing
     */
    it('should set nextCommand to null', () => {
      // GIVEN: Existing nextCommand
      fs.writeFileSync(projectWorkflowFile, JSON.stringify({ nextCommand: 'ship' }));

      // WHEN: Running clearNextCommand
      execSync(`node "${cliPath}" --project-dir "${testProjectDir}" clearNextCommand`, {
        timeout: 10000,
        encoding: 'utf-8',
      });

      // THEN: State should have nextCommand=null
      const state = JSON.parse(fs.readFileSync(projectWorkflowFile, 'utf-8'));
      expect(state.nextCommand).toBeNull();
    });
  });
});
