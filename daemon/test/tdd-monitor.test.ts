/**
 * @behavior TddMonitor detects stale TDD phases
 * @acceptance-criteria AC-DAEMON-011
 * @business-rule DAEMON-011 - TDD phases should not be stuck for too long
 * @boundary File System
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { TddMonitor, TddMonitorConfig } from '../src/tdd-monitor.js';

describe('TddMonitor', () => {
  const testDir = path.join(tmpdir(), `oss-tdd-monitor-test-${Date.now()}`);
  let monitor: TddMonitor;
  const config: TddMonitorConfig = {
    ossDir: testDir,
    staleThresholdMs: 30 * 60 * 1000 // 30 minutes
  };

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    monitor = new TddMonitor(config);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('Stale Phase Detection', () => {
    it('should detect TDD phase stuck for too long', async () => {
      const stateFile = path.join(testDir, 'workflow-state.json');
      await fs.writeFile(stateFile, JSON.stringify({
        tddPhase: 'red',
        tddPhaseStarted: new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
      }));

      const issue = await monitor.checkStaleTddPhase();

      expect(issue).not.toBeNull();
      expect(issue?.type).toBe('stale_tdd_phase');
      expect(issue?.message).toContain('RED');
      expect(issue?.severity).toBe('warning');
    });

    it('should not flag recent TDD phase as stale', async () => {
      const stateFile = path.join(testDir, 'workflow-state.json');
      await fs.writeFile(stateFile, JSON.stringify({
        tddPhase: 'green',
        tddPhaseStarted: new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 minutes ago
      }));

      const issue = await monitor.checkStaleTddPhase();

      expect(issue).toBeNull();
    });

    it('should return null when no TDD phase is active', async () => {
      const stateFile = path.join(testDir, 'workflow-state.json');
      await fs.writeFile(stateFile, JSON.stringify({
        someOtherField: 'value'
      }));

      const issue = await monitor.checkStaleTddPhase();

      expect(issue).toBeNull();
    });

    it('should return null when workflow-state.json does not exist', async () => {
      const issue = await monitor.checkStaleTddPhase();

      expect(issue).toBeNull();
    });

    it('should handle missing tddPhaseStarted gracefully', async () => {
      const stateFile = path.join(testDir, 'workflow-state.json');
      await fs.writeFile(stateFile, JSON.stringify({
        tddPhase: 'red'
        // No tddPhaseStarted - should not crash
      }));

      const issue = await monitor.checkStaleTddPhase();

      // Without a start time, we can't determine if it's stale
      expect(issue).toBeNull();
    });
  });

  describe('TDD Phase Formatting', () => {
    it('should uppercase phase name in message', async () => {
      const stateFile = path.join(testDir, 'workflow-state.json');
      await fs.writeFile(stateFile, JSON.stringify({
        tddPhase: 'refactor',
        tddPhaseStarted: new Date(Date.now() - 60 * 60 * 1000).toISOString()
      }));

      const issue = await monitor.checkStaleTddPhase();

      expect(issue?.message).toContain('REFACTOR');
    });
  });
});
