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

import {
  StatusLineService,
  TDDPhase,
  SupervisorStatus,
  ContextHealthLevel,
  ContextHealthInfo,
  calculateContextHealthLevel,
} from '../../src/services/status-line.js';

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
        contextHealth: null,
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

  describe('Context Health', () => {
    describe('setContextHealth', () => {
      it('should persist context health info', async () => {
        const healthInfo: ContextHealthInfo = {
          level: 'healthy',
          usagePercent: 25,
          tokensUsed: 25000,
          tokensTotal: 100000,
        };

        await service.setContextHealth(healthInfo);

        const state = await service.getState();
        expect(state.contextHealth).toEqual(healthInfo);
      });

      it('should persist context health with minimal info', async () => {
        const healthInfo: ContextHealthInfo = {
          level: 'warning',
          usagePercent: 55,
        };

        await service.setContextHealth(healthInfo);

        const state = await service.getState();
        expect(state.contextHealth).toEqual(healthInfo);
      });

      it('should update context health when called multiple times', async () => {
        await service.setContextHealth({ level: 'healthy', usagePercent: 30 });
        await service.setContextHealth({ level: 'critical', usagePercent: 85 });

        const state = await service.getState();
        expect(state.contextHealth?.level).toBe('critical');
        expect(state.contextHealth?.usagePercent).toBe(85);
      });

      it('should persist context health to file', async () => {
        const healthInfo: ContextHealthInfo = {
          level: 'warning',
          usagePercent: 60,
          tokensUsed: 60000,
          tokensTotal: 100000,
        };

        await service.setContextHealth(healthInfo);

        // Read file directly to verify persistence
        const filePath = path.join(testDir, 'status-line.json');
        const content = await fs.readFile(filePath, 'utf-8');
        const fileState = JSON.parse(content);

        expect(fileState.contextHealth).toEqual(healthInfo);
      });
    });

    describe('default state', () => {
      it('should have contextHealth as null in default state', async () => {
        const freshService = new StatusLineService(testDir);
        await freshService.initialize();

        const state = await freshService.getState();
        expect(state.contextHealth).toBeNull();
      });
    });

    describe('clearState with contextHealth', () => {
      it('should clear contextHealth when clearState is called', async () => {
        await service.setContextHealth({ level: 'warning', usagePercent: 55 });
        await service.clearState();

        const state = await service.getState();
        expect(state.contextHealth).toBeNull();
      });
    });
  });

  describe('calculateContextHealthLevel', () => {
    it('should return healthy when usage is below 50%', () => {
      expect(calculateContextHealthLevel(0)).toBe('healthy');
      expect(calculateContextHealthLevel(25)).toBe('healthy');
      expect(calculateContextHealthLevel(49)).toBe('healthy');
      expect(calculateContextHealthLevel(49.9)).toBe('healthy');
    });

    it('should return warning when usage is 50% to below 70%', () => {
      expect(calculateContextHealthLevel(50)).toBe('warning');
      expect(calculateContextHealthLevel(55)).toBe('warning');
      expect(calculateContextHealthLevel(69)).toBe('warning');
      expect(calculateContextHealthLevel(69.9)).toBe('warning');
    });

    it('should return critical when usage is 70% or above', () => {
      expect(calculateContextHealthLevel(70)).toBe('critical');
      expect(calculateContextHealthLevel(85)).toBe('critical');
      expect(calculateContextHealthLevel(100)).toBe('critical');
    });
  });
});
