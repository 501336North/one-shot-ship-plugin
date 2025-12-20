/**
 * @behavior StateManager writes and clears issues to workflow-state.json
 * @acceptance-criteria AC-DAEMON-009
 * @business-rule DAEMON-009 - Status line must know about issues
 * @boundary File System
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { StateManager, Issue } from '../src/state-manager.js';

describe('StateManager', () => {
  const testDir = path.join(tmpdir(), `oss-state-manager-test-${Date.now()}`);
  let manager: StateManager;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    manager = new StateManager({ ossDir: testDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('Issue Reporting', () => {
    it('should write issue to workflow-state.json', async () => {
      const issue: Issue = {
        type: 'hung_process',
        message: 'npm test running for 5+ minutes',
        severity: 'warning'
      };

      await manager.reportIssue(issue);

      const statePath = path.join(testDir, 'workflow-state.json');
      const stateContent = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(stateContent);

      expect(state.issue).toBeDefined();
      expect(state.issue.type).toBe('hung_process');
      expect(state.issue.severity).toBe('warning');
      expect(state.issue.message).toContain('5+ minutes');
    });

    it('should preserve existing state when writing issue', async () => {
      // Write some existing state
      const statePath = path.join(testDir, 'workflow-state.json');
      await fs.writeFile(statePath, JSON.stringify({
        tddPhase: 'green',
        daemonHeartbeat: '2025-01-01T00:00:00Z'
      }));

      const issue: Issue = {
        type: 'branch_violation',
        message: 'On main branch',
        severity: 'error'
      };

      await manager.reportIssue(issue);

      const stateContent = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(stateContent);

      expect(state.tddPhase).toBe('green');
      expect(state.daemonHeartbeat).toBe('2025-01-01T00:00:00Z');
      expect(state.issue.type).toBe('branch_violation');
    });
  });

  describe('Issue Clearing', () => {
    it('should clear issue when resolved', async () => {
      await manager.reportIssue({
        type: 'test_issue',
        message: 'Test issue',
        severity: 'info'
      });

      await manager.clearIssue();

      const statePath = path.join(testDir, 'workflow-state.json');
      const stateContent = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(stateContent);

      expect(state.issue).toBeNull();
    });

    it('should preserve other state when clearing issue', async () => {
      const statePath = path.join(testDir, 'workflow-state.json');
      await fs.writeFile(statePath, JSON.stringify({
        tddPhase: 'refactor',
        issue: { type: 'test', message: 'test', severity: 'info' }
      }));

      await manager.clearIssue();

      const stateContent = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(stateContent);

      expect(state.tddPhase).toBe('refactor');
      expect(state.issue).toBeNull();
    });
  });

  describe('Issue Reading', () => {
    it('should read current issue from state', async () => {
      const issue: Issue = {
        type: 'stale_tdd_phase',
        message: 'RED phase stuck for 30+ minutes',
        severity: 'warning'
      };

      await manager.reportIssue(issue);

      const currentIssue = await manager.getCurrentIssue();

      expect(currentIssue).not.toBeNull();
      expect(currentIssue?.type).toBe('stale_tdd_phase');
    });

    it('should return null when no issue exists', async () => {
      const currentIssue = await manager.getCurrentIssue();

      expect(currentIssue).toBeNull();
    });
  });
});
