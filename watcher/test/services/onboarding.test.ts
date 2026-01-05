/**
 * @behavior Onboarding service provides streamlined first-time experience
 * @acceptance-criteria Users get started in under 3 minutes
 * @business-rule Time-to-first-value under 2 minutes
 * @boundary Service (OnboardingService)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Onboarding Service', () => {
  const testConfigDir = path.join(os.tmpdir(), `oss-onboarding-test-${Date.now()}`);
  const testConfigPath = path.join(testConfigDir, 'config.json');

  beforeEach(() => {
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  describe('setup phases', () => {
    /**
     * @behavior Onboarding has 3 phases: Essential, Recommended, Optional
     * @acceptance-criteria Clear phase structure
     */
    it('should have three onboarding phases', async () => {
      const { OnboardingService } = await import('../../src/services/onboarding');

      const service = new OnboardingService({ configDir: testConfigDir });
      const phases = service.getPhases();

      expect(phases).toHaveLength(3);
      expect(phases[0].name).toBe('Essential');
      expect(phases[1].name).toBe('Recommended');
      expect(phases[2].name).toBe('Optional');
    });

    /**
     * @behavior Essential phase only requires API key
     * @acceptance-criteria Minimal barrier to start
     */
    it('should have minimal essential phase', async () => {
      const { OnboardingService } = await import('../../src/services/onboarding');

      const service = new OnboardingService({ configDir: testConfigDir });
      const essentialPhase = service.getPhases()[0];

      expect(essentialPhase.steps.length).toBeLessThanOrEqual(3);
      expect(essentialPhase.steps.some(s => s.id === 'api-key')).toBe(true);
    });
  });

  describe('progress tracking', () => {
    /**
     * @behavior Tracks onboarding completion percentage
     * @acceptance-criteria Shows progress through phases
     */
    it('should track completion percentage', async () => {
      const { OnboardingService } = await import('../../src/services/onboarding');

      const service = new OnboardingService({ configDir: testConfigDir });

      expect(service.getCompletionPercentage()).toBe(0);

      service.completeStep('api-key');
      expect(service.getCompletionPercentage()).toBeGreaterThan(0);
    });

    /**
     * @behavior Remembers completed steps
     * @acceptance-criteria Persistent progress
     */
    it('should remember completed steps', async () => {
      const { OnboardingService } = await import('../../src/services/onboarding');

      const service = new OnboardingService({ configDir: testConfigDir });

      service.completeStep('api-key');
      service.completeStep('verify-install');

      const completedSteps = service.getCompletedSteps();
      expect(completedSteps).toContain('api-key');
      expect(completedSteps).toContain('verify-install');
    });
  });

  describe('pre-flight checks', () => {
    /**
     * @behavior Pre-flight checks validate system requirements
     * @acceptance-criteria Returns list of checks with status
     */
    it('should run pre-flight checks', async () => {
      const { OnboardingService } = await import('../../src/services/onboarding');

      const service = new OnboardingService({ configDir: testConfigDir });
      const checks = await service.runPreflightChecks();

      expect(checks.length).toBeGreaterThan(0);
      expect(checks[0]).toHaveProperty('name');
      expect(checks[0]).toHaveProperty('status');
    });

    /**
     * @behavior Checks include git and node
     * @acceptance-criteria Essential tools are verified
     */
    it('should check for essential tools', async () => {
      const { OnboardingService } = await import('../../src/services/onboarding');

      const service = new OnboardingService({ configDir: testConfigDir });
      const checks = await service.runPreflightChecks();

      const checkNames = checks.map(c => c.name);
      expect(checkNames).toContain('git');
      expect(checkNames).toContain('node');
    });
  });

  describe('hello world demo', () => {
    /**
     * @behavior Hello World shows OSS working without config
     * @acceptance-criteria Demonstrates value immediately
     */
    it('should provide hello world demo', async () => {
      const { OnboardingService } = await import('../../src/services/onboarding');

      const service = new OnboardingService({ configDir: testConfigDir });
      const demo = service.getHelloWorldDemo();

      expect(demo.title).toBeDefined();
      expect(demo.description).toBeDefined();
      expect(demo.steps.length).toBeGreaterThan(0);
    });

    /**
     * @behavior Demo is executable without authentication
     * @acceptance-criteria No barriers to trying OSS
     */
    it('should be executable without auth', async () => {
      const { OnboardingService } = await import('../../src/services/onboarding');

      const service = new OnboardingService({ configDir: testConfigDir });
      const demo = service.getHelloWorldDemo();

      expect(demo.requiresAuth).toBe(false);
    });
  });

  describe('setup validation', () => {
    /**
     * @behavior Can validate entire setup
     * @acceptance-criteria Returns health status
     */
    it('should validate setup', async () => {
      const { OnboardingService } = await import('../../src/services/onboarding');

      const service = new OnboardingService({ configDir: testConfigDir });
      const validation = await service.validateSetup();

      expect(validation).toHaveProperty('healthy');
      expect(validation).toHaveProperty('issues');
    });

    /**
     * @behavior Identifies specific issues
     * @acceptance-criteria Users know what to fix
     */
    it('should identify issues', async () => {
      const { OnboardingService } = await import('../../src/services/onboarding');

      const service = new OnboardingService({ configDir: testConfigDir });
      const validation = await service.validateSetup();

      // Without config, should have issues
      expect(validation.healthy).toBe(false);
      expect(validation.issues.length).toBeGreaterThan(0);
    });
  });

  describe('time estimates', () => {
    /**
     * @behavior Provides time estimate for each phase
     * @acceptance-criteria Users know commitment upfront
     */
    it('should provide time estimates', async () => {
      const { OnboardingService } = await import('../../src/services/onboarding');

      const service = new OnboardingService({ configDir: testConfigDir });
      const phases = service.getPhases();

      for (const phase of phases) {
        expect(phase.estimatedTime).toBeDefined();
        expect(typeof phase.estimatedTime).toBe('string');
      }
    });

    /**
     * @behavior Essential phase is under 2 minutes
     * @acceptance-criteria Fast time-to-value
     */
    it('should have fast essential phase', async () => {
      const { OnboardingService } = await import('../../src/services/onboarding');

      const service = new OnboardingService({ configDir: testConfigDir });
      const essentialPhase = service.getPhases()[0];

      // Extract number from "X minutes" or "X min"
      const match = essentialPhase.estimatedTime.match(/(\d+)/);
      const minutes = match ? parseInt(match[1]) : 0;

      expect(minutes).toBeLessThanOrEqual(2);
    });
  });
});
