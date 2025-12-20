/**
 * @behavior Status line shows current TDD phase
 * @acceptance-criteria AC-STATUS-001
 * @business-rule STATUS-001
 * @boundary IPC/File
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { StatusLineService, TDDPhase, SupervisorStatus } from '../../src/services/status-line.js';

describe('StatusLineService', () => {
  const testDir = path.join(tmpdir(), `oss-status-test-${Date.now()}`);
  let service: StatusLineService;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    service = new StatusLineService(testDir);
    await service.initialize();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('setTDDPhase', () => {
    it('should write RED phase to workflow-state.json', async () => {
      await service.setTDDPhase('RED');

      const state = await service.getState();
      expect(state.phase).toBe('RED');
    });

    it('should write GREEN phase to workflow-state.json', async () => {
      await service.setTDDPhase('GREEN');

      const state = await service.getState();
      expect(state.phase).toBe('GREEN');
    });

    it('should write REFACTOR phase to workflow-state.json', async () => {
      await service.setTDDPhase('REFACTOR');

      const state = await service.getState();
      expect(state.phase).toBe('REFACTOR');
    });
  });

  describe('setTaskProgress', () => {
    it('should store task progress as current/total', async () => {
      await service.setTaskProgress(3, 8);

      const state = await service.getState();
      expect(state.task).toBe('3/8');
    });

    it('should update task progress', async () => {
      await service.setTaskProgress(1, 5);
      await service.setTaskProgress(4, 5);

      const state = await service.getState();
      expect(state.task).toBe('4/5');
    });
  });

  describe('setSupervisorStatus', () => {
    it('should set supervisor status to watching', async () => {
      await service.setSupervisorStatus('watching');

      const state = await service.getState();
      expect(state.supervisor).toBe('watching');
    });

    it('should set supervisor status to intervening', async () => {
      await service.setSupervisorStatus('intervening');

      const state = await service.getState();
      expect(state.supervisor).toBe('intervening');
    });

    it('should set supervisor status to idle', async () => {
      await service.setSupervisorStatus('idle');

      const state = await service.getState();
      expect(state.supervisor).toBe('idle');
    });
  });

  describe('getState', () => {
    it('should return complete status line state', async () => {
      await service.setTDDPhase('GREEN');
      await service.setTaskProgress(5, 10);
      await service.setSupervisorStatus('watching');

      const state = await service.getState();
      expect(state).toEqual({
        phase: 'GREEN',
        task: '5/10',
        supervisor: 'watching',
      });
    });

    it('should return default state when uninitialized', async () => {
      const freshService = new StatusLineService(testDir);
      await freshService.initialize();

      const state = await freshService.getState();
      expect(state.phase).toBeNull();
      expect(state.task).toBeNull();
      expect(state.supervisor).toBeNull();
    });
  });

  describe('persistence', () => {
    it('should persist state to status-line.json file', async () => {
      await service.setTDDPhase('RED');
      await service.setTaskProgress(1, 5);
      await service.setSupervisorStatus('watching');

      // Read file directly
      const filePath = path.join(testDir, 'status-line.json');
      const content = await fs.readFile(filePath, 'utf-8');
      const fileState = JSON.parse(content);

      expect(fileState.phase).toBe('RED');
      expect(fileState.task).toBe('1/5');
      expect(fileState.supervisor).toBe('watching');
    });

    it('should load state on initialization', async () => {
      // Write state directly
      const filePath = path.join(testDir, 'status-line.json');
      await fs.writeFile(
        filePath,
        JSON.stringify({ phase: 'GREEN', task: '3/8', supervisor: 'idle' })
      );

      // Create new service and initialize
      const newService = new StatusLineService(testDir);
      await newService.initialize();

      const state = await newService.getState();
      expect(state.phase).toBe('GREEN');
      expect(state.task).toBe('3/8');
      expect(state.supervisor).toBe('idle');
    });
  });

  describe('clearState', () => {
    it('should clear all state values', async () => {
      await service.setTDDPhase('RED');
      await service.setTaskProgress(5, 10);
      await service.setSupervisorStatus('watching');

      await service.clearState();

      const state = await service.getState();
      expect(state.phase).toBeNull();
      expect(state.task).toBeNull();
      expect(state.supervisor).toBeNull();
    });
  });
});
