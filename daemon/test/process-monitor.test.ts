/**
 * @behavior Monitor detects hung test processes
 * @acceptance-criteria AC-DAEMON-002
 * @business-rule DAEMON-002
 * @boundary System Process
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { ProcessMonitor, ProcessInfo, ProcessType } from '../src/process-monitor.js';

describe('ProcessMonitor', () => {
  const testDir = path.join(tmpdir(), `oss-process-monitor-test-${Date.now()}`);
  let monitor: ProcessMonitor;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    monitor = new ProcessMonitor();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('Process Detection', () => {
    it('should detect vitest processes', async () => {
      const processes = await monitor.findProcesses('vitest');

      // May or may not find vitest depending on test runner
      expect(Array.isArray(processes)).toBe(true);
      if (processes.length > 0) {
        expect(processes[0]).toHaveProperty('pid');
        expect(processes[0]).toHaveProperty('command');
        expect(processes[0]).toHaveProperty('startTime');
      }
    });

    it('should detect npm test processes', async () => {
      const processes = await monitor.findProcesses('npm');

      expect(Array.isArray(processes)).toBe(true);
    });

    it('should return process info with required fields', async () => {
      // Use a command we know is running (this test process)
      const processes = await monitor.findProcesses('node');

      expect(processes.length).toBeGreaterThan(0);
      const proc = processes[0];
      expect(proc.pid).toBeGreaterThan(0);
      expect(proc.command).toBeTruthy();
      expect(proc.startTime).toBeInstanceOf(Date);
    });
  });

  describe('Process Age Tracking', () => {
    it('should calculate process age correctly', async () => {
      const processes = await monitor.findProcesses('node');

      if (processes.length > 0) {
        const age = monitor.getProcessAge(processes[0]);
        expect(age).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Hung Process Identification', () => {
    it('should identify process exceeding timeout as hung', () => {
      const oldProcess: ProcessInfo = {
        pid: 12345,
        command: 'vitest',
        startTime: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
        cpuPercent: 50,
        memoryMB: 100
      };

      // 5 minute threshold
      const isHung = monitor.isProcessHung(oldProcess, 5 * 60 * 1000);
      expect(isHung).toBe(true);
    });

    it('should not identify young process as hung', () => {
      const youngProcess: ProcessInfo = {
        pid: 12345,
        command: 'vitest',
        startTime: new Date(Date.now() - 30 * 1000), // 30 seconds ago
        cpuPercent: 50,
        memoryMB: 100
      };

      // 5 minute threshold
      const isHung = monitor.isProcessHung(youngProcess, 5 * 60 * 1000);
      expect(isHung).toBe(false);
    });
  });

  describe('Process Type Detection', () => {
    it('should identify vitest process type', () => {
      const type = monitor.getProcessType('node /path/to/vitest run');
      expect(type).toBe('vitest');
    });

    it('should identify npm test process type', () => {
      const type = monitor.getProcessType('npm test');
      expect(type).toBe('npm-test');
    });

    it('should return unknown for unrecognized commands', () => {
      const type = monitor.getProcessType('some-random-command');
      expect(type).toBe('unknown');
    });
  });
});
