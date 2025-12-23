/**
 * BackgroundAgent Types Tests
 *
 * @behavior Background agents implement a common interface
 * @acceptance-criteria All agents must have initialize, start, stop, poll, getStatus methods
 * @business-rule Agents are pluggable components with consistent lifecycle
 * @boundary Type definitions
 */

import { describe, it, expect } from 'vitest';

// These imports will fail until we create the types file
import {
  isBackgroundAgent,
  DEFAULT_AGENT_CONFIG,
  type BackgroundAgent,
  type AgentStatus,
  type AgentConfig,
  type AgentMetadata,
} from '../../src/agents/types';

describe('BackgroundAgent Types', () => {
  describe('BackgroundAgent Interface', () => {
    it('should define BackgroundAgent interface with required methods', () => {
      // GIVEN - A type that implements BackgroundAgent
      const agent: BackgroundAgent = {
        metadata: {
          name: 'test-agent',
          description: 'Test agent',
          version: '1.0.0',
        },
        initialize: async () => {},
        start: async () => {},
        stop: async () => {},
        poll: async () => {},
        getStatus: () => ({
          isRunning: false,
          lastPollTime: null,
          errorCount: 0,
          lastError: null,
        }),
      };

      // THEN - All required methods should be present
      expect(typeof agent.initialize).toBe('function');
      expect(typeof agent.start).toBe('function');
      expect(typeof agent.stop).toBe('function');
      expect(typeof agent.poll).toBe('function');
      expect(typeof agent.getStatus).toBe('function');
      expect(agent.metadata).toBeDefined();
    });

    it('should validate BackgroundAgent with isBackgroundAgent type guard', () => {
      // GIVEN - A valid agent implementation
      const validAgent = {
        metadata: { name: 'test', description: 'Test', version: '1.0.0' },
        initialize: async () => {},
        start: async () => {},
        stop: async () => {},
        poll: async () => {},
        getStatus: () => ({ isRunning: false, lastPollTime: null, errorCount: 0, lastError: null }),
      };

      // WHEN - We validate with type guard
      const result = isBackgroundAgent(validAgent);

      // THEN - It should be a valid BackgroundAgent
      expect(result).toBe(true);
    });

    it('should reject invalid agent with isBackgroundAgent type guard', () => {
      // GIVEN - An invalid object missing required methods
      const invalidAgent = {
        metadata: { name: 'test' },
        initialize: async () => {},
        // Missing: start, stop, poll, getStatus
      };

      // WHEN - We validate with type guard
      const result = isBackgroundAgent(invalidAgent);

      // THEN - It should not be a valid BackgroundAgent
      expect(result).toBe(false);
    });
  });

  describe('AgentStatus Type', () => {
    it('should define AgentStatus type with health metrics', () => {
      // GIVEN - An AgentStatus object
      const status: AgentStatus = {
        isRunning: true,
        lastPollTime: '2025-12-23T12:00:00Z',
        errorCount: 2,
        lastError: 'Connection timeout',
      };

      // THEN - All required properties should exist with correct types
      expect(typeof status.isRunning).toBe('boolean');
      expect(status.lastPollTime).toBeDefined();
      expect(typeof status.errorCount).toBe('number');
      expect(status.lastError).toBeDefined();
    });

    it('should allow null values for optional health metrics', () => {
      // GIVEN - An AgentStatus with null optional fields
      const status: AgentStatus = {
        isRunning: false,
        lastPollTime: null,
        errorCount: 0,
        lastError: null,
      };

      // THEN - Null values should be acceptable
      expect(status.lastPollTime).toBeNull();
      expect(status.lastError).toBeNull();
    });
  });

  describe('AgentConfig Type', () => {
    it('should define AgentConfig type with common settings', () => {
      // GIVEN - An AgentConfig object
      const config: AgentConfig = {
        enabled: true,
        interval: 300000, // 5 minutes in ms
        maxRetries: 3,
        retryOnFailure: true,
      };

      // THEN - All required properties should exist with correct types
      expect(typeof config.enabled).toBe('boolean');
      expect(typeof config.interval).toBe('number');
      expect(typeof config.maxRetries).toBe('number');
      expect(typeof config.retryOnFailure).toBe('boolean');
    });

    it('should support optional name override in config', () => {
      // GIVEN - An AgentConfig with optional name override
      const config: AgentConfig = {
        enabled: true,
        interval: 60000,
        maxRetries: 1,
        retryOnFailure: false,
        name: 'custom-name',
      };

      // THEN - Optional name should be accessible
      expect(config.name).toBe('custom-name');
    });

    it('should provide sensible DEFAULT_AGENT_CONFIG', () => {
      // THEN - Default config should have reasonable values
      expect(DEFAULT_AGENT_CONFIG.enabled).toBe(false);
      expect(DEFAULT_AGENT_CONFIG.interval).toBe(300000); // 5 minutes
      expect(DEFAULT_AGENT_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_AGENT_CONFIG.retryOnFailure).toBe(true);
    });
  });

  describe('AgentMetadata Type', () => {
    it('should define AgentMetadata type with static agent information', () => {
      // GIVEN - An AgentMetadata object
      const metadata: AgentMetadata = {
        name: 'pr-monitor',
        description: 'Monitors PRs for review comments',
        version: '1.0.0',
      };

      // THEN - All required properties should exist with correct types
      expect(typeof metadata.name).toBe('string');
      expect(typeof metadata.description).toBe('string');
      expect(typeof metadata.version).toBe('string');
    });
  });
});
