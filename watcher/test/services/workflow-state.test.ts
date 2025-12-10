/**
 * WorkflowStateService Tests
 *
 * @behavior Track workflow step progression (ideate → plan → build → ship)
 * @acceptance-criteria
 *   - AC-001: Track current feature name
 *   - AC-002: Track last completed workflow step
 *   - AC-003: Track timestamp of last step completion
 *   - AC-004: Persist state to ~/.oss/workflow-state.json
 *   - AC-005: Provide state for health check decisions
 * @boundary Service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { WorkflowStateService, WorkflowStep, WorkflowState } from '../../src/services/workflow-state.js';

describe('WorkflowStateService', () => {
  const testDir = '/tmp/oss-workflow-state-test';
  const stateFile = path.join(testDir, 'health-workflow-state.json');
  let service: WorkflowStateService;

  beforeEach(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(testDir, { recursive: true });
    service = new WorkflowStateService(testDir);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    /**
     * @behavior Service initializes with empty state if no state file exists
     */
    it('should initialize with empty state when no file exists', async () => {
      await service.initialize();
      const state = await service.getState();

      expect(state).toBeDefined();
      expect(state.currentFeature).toBeNull();
      expect(state.lastCompletedStep).toBeNull();
      expect(state.lastStepTimestamp).toBeNull();
    });

    /**
     * @behavior Service loads existing state from file
     */
    it('should load existing state from file', async () => {
      const existingState: WorkflowState = {
        currentFeature: 'my-feature',
        lastCompletedStep: 'build',
        lastStepTimestamp: '2025-12-10T10:00:00Z',
      };
      await fs.writeFile(stateFile, JSON.stringify(existingState, null, 2));

      await service.initialize();
      const state = await service.getState();

      expect(state.currentFeature).toBe('my-feature');
      expect(state.lastCompletedStep).toBe('build');
      expect(state.lastStepTimestamp).toBe('2025-12-10T10:00:00Z');
    });
  });

  describe('setCurrentFeature', () => {
    /**
     * @behavior Can set the current feature being worked on
     */
    it('should set and persist current feature', async () => {
      await service.initialize();
      await service.setCurrentFeature('new-feature');

      const state = await service.getState();
      expect(state.currentFeature).toBe('new-feature');

      // Verify persisted
      const fileContent = await fs.readFile(stateFile, 'utf-8');
      const persisted = JSON.parse(fileContent);
      expect(persisted.currentFeature).toBe('new-feature');
    });

    /**
     * @behavior Setting feature clears last step (starting fresh)
     */
    it('should clear last step when setting new feature', async () => {
      await service.initialize();
      await service.completeStep('build');
      await service.setCurrentFeature('new-feature');

      const state = await service.getState();
      expect(state.currentFeature).toBe('new-feature');
      expect(state.lastCompletedStep).toBeNull();
      expect(state.lastStepTimestamp).toBeNull();
    });
  });

  describe('completeStep', () => {
    /**
     * @behavior Records step completion with timestamp
     */
    it('should record step completion with timestamp', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-12-10T12:00:00Z'));

      await service.initialize();
      await service.setCurrentFeature('test-feature');
      await service.completeStep('ideate');

      const state = await service.getState();
      expect(state.lastCompletedStep).toBe('ideate');
      expect(state.lastStepTimestamp).toBe('2025-12-10T12:00:00.000Z');

      vi.useRealTimers();
    });

    /**
     * @behavior Validates workflow step values
     */
    it('should only accept valid workflow steps', async () => {
      await service.initialize();
      await service.setCurrentFeature('test-feature');

      // Valid steps
      await expect(service.completeStep('ideate')).resolves.not.toThrow();
      await expect(service.completeStep('plan')).resolves.not.toThrow();
      await expect(service.completeStep('build')).resolves.not.toThrow();
      await expect(service.completeStep('ship')).resolves.not.toThrow();

      // Invalid step
      await expect(service.completeStep('invalid' as WorkflowStep)).rejects.toThrow();
    });

    /**
     * @behavior Persists to file after each step completion
     */
    it('should persist state to file', async () => {
      await service.initialize();
      await service.setCurrentFeature('persist-test');
      await service.completeStep('plan');

      const fileContent = await fs.readFile(stateFile, 'utf-8');
      const persisted = JSON.parse(fileContent);
      expect(persisted.lastCompletedStep).toBe('plan');
    });
  });

  describe('clearState', () => {
    /**
     * @behavior Clears all workflow state
     */
    it('should clear all state', async () => {
      await service.initialize();
      await service.setCurrentFeature('feature');
      await service.completeStep('build');
      await service.clearState();

      const state = await service.getState();
      expect(state.currentFeature).toBeNull();
      expect(state.lastCompletedStep).toBeNull();
      expect(state.lastStepTimestamp).toBeNull();
    });
  });

  describe('getStepAge', () => {
    /**
     * @behavior Returns age of last step in hours
     */
    it('should return age of last step in hours', async () => {
      vi.useFakeTimers();

      // Set step completed 25 hours ago
      const stepTime = new Date('2025-12-09T10:00:00Z');
      vi.setSystemTime(stepTime);

      await service.initialize();
      await service.setCurrentFeature('test');
      await service.completeStep('ship');

      // Now check 25 hours later
      vi.setSystemTime(new Date('2025-12-10T11:00:00Z'));
      const ageHours = await service.getStepAgeHours();

      expect(ageHours).toBe(25);

      vi.useRealTimers();
    });

    /**
     * @behavior Returns null if no step completed
     */
    it('should return null if no step completed', async () => {
      await service.initialize();
      const ageHours = await service.getStepAgeHours();
      expect(ageHours).toBeNull();
    });
  });

  describe('shouldWarnAboutArchive', () => {
    /**
     * @behavior Returns false if last step is ship (archiving expected on next plan)
     */
    it('should not warn if last step is ship', async () => {
      await service.initialize();
      await service.setCurrentFeature('completed-feature');
      await service.completeStep('ship');

      const shouldWarn = await service.shouldWarnAboutArchive();
      expect(shouldWarn).toBe(false);
    });

    /**
     * @behavior Returns false if last step is plan and <24h old
     */
    it('should not warn if last step is plan and recent', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-12-10T12:00:00Z'));

      await service.initialize();
      await service.setCurrentFeature('feature');
      await service.completeStep('plan');

      // Check 12 hours later (still under 24h)
      vi.setSystemTime(new Date('2025-12-11T00:00:00Z'));
      const shouldWarn = await service.shouldWarnAboutArchive();
      expect(shouldWarn).toBe(false);

      vi.useRealTimers();
    });

    /**
     * @behavior Returns true if last step is plan and >24h old
     */
    it('should warn if last step is plan and >24h old', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-12-09T10:00:00Z'));

      await service.initialize();
      await service.setCurrentFeature('stale-feature');
      await service.completeStep('plan');

      // Check 25 hours later
      vi.setSystemTime(new Date('2025-12-10T11:00:00Z'));
      const shouldWarn = await service.shouldWarnAboutArchive();
      expect(shouldWarn).toBe(true);

      vi.useRealTimers();
    });

    /**
     * @behavior Returns false if no workflow state
     */
    it('should not warn if no workflow state', async () => {
      await service.initialize();
      const shouldWarn = await service.shouldWarnAboutArchive();
      expect(shouldWarn).toBe(false);
    });
  });
});
