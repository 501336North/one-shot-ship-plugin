/**
 * Watcher-Agents Integration Tests
 *
 * @behavior Agents integrate with watcher lifecycle and hooks
 * @acceptance-criteria Agents start/stop with watcher, hooks trigger agent work
 * @business-rule Enabled agents poll, disabled agents don't
 * @boundary Watcher Integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WatcherAgentIntegration } from '../../src/integration/watcher-agents';
import { AgentRegistry } from '../../src/agents/registry';
import { PRMonitorAgent } from '../../src/agents/pr-monitor';
import { PRMonitorState } from '../../src/agents/pr-monitor-state';
import { GitHubClient } from '../../src/agents/github-client';
import * as config from '../../src/agents/config';

// Mock dependencies
vi.mock('../../src/agents/pr-monitor-state');
vi.mock('../../src/agents/github-client');
vi.mock('../../src/agents/config');

describe('Watcher-Agent Integration', () => {
  let integration: WatcherAgentIntegration;
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
    integration = new WatcherAgentIntegration(registry);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await registry.stopAll();
    vi.restoreAllMocks();
  });

  describe('Agent Registration', () => {
    it('should register PR monitor agent on watcher start', async () => {
      // GIVEN - Default config with agent enabled
      vi.mocked(config.getAgentConfig).mockResolvedValue({
        enabled: true,
        interval: 300000,
        maxRetries: 3,
        retryOnFailure: true,
      });

      // WHEN - We initialize integration
      await integration.initialize();

      // THEN - PR monitor should be registered
      expect(registry.has('pr-monitor')).toBe(true);
    });

    it('should start enabled agents from config', async () => {
      // GIVEN - Agent enabled in config
      vi.mocked(config.getAgentConfig).mockResolvedValue({
        enabled: true,
        interval: 60000,
        maxRetries: 3,
        retryOnFailure: true,
      });

      // WHEN - We initialize integration
      await integration.initialize();

      // Wait a bit for async start
      await new Promise((resolve) => setTimeout(resolve, 50));

      // THEN - Agent should be running
      const agent = registry.get('pr-monitor');
      expect(agent).toBeDefined();
      const status = agent!.getStatus();
      expect(status.isRunning).toBe(true);
    });

    it('should not start disabled agents', async () => {
      // GIVEN - Agent disabled in config
      vi.mocked(config.getAgentConfig).mockResolvedValue({
        enabled: false,
        interval: 60000,
        maxRetries: 3,
        retryOnFailure: true,
      });

      // WHEN - We initialize integration
      await integration.initialize();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      // THEN - Agent should not be running
      const agent = registry.get('pr-monitor');
      expect(agent).toBeDefined();
      const status = agent!.getStatus();
      expect(status.isRunning).toBe(false);
    });
  });

  describe('SessionStart Hook', () => {
    it('should start agent registry on SessionStart', async () => {
      // GIVEN - Registry initialized
      vi.mocked(config.getAgentConfig).mockResolvedValue({
        enabled: true,
        interval: 60000,
        maxRetries: 3,
        retryOnFailure: true,
      });
      await integration.initialize();

      // WHEN - SessionStart hook fires
      await integration.onSessionStart();

      // THEN - Enabled agents should be running
      await new Promise((resolve) => setTimeout(resolve, 50));
      const agent = registry.get('pr-monitor');
      expect(agent?.getStatus().isRunning).toBe(true);
    });

    it('should stop agents on session end', async () => {
      // GIVEN - Agents running
      vi.mocked(config.getAgentConfig).mockResolvedValue({
        enabled: true,
        interval: 60000,
        maxRetries: 3,
        retryOnFailure: true,
      });
      await integration.initialize();
      await integration.onSessionStart();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // WHEN - Session ends
      await integration.onSessionEnd();

      // THEN - All agents should be stopped
      const agent = registry.get('pr-monitor');
      expect(agent?.getStatus().isRunning).toBe(false);
    });
  });

  describe('preCommand Hook', () => {
    it('should check for PR tasks before command', async () => {
      // GIVEN - Integration initialized with mock agent
      vi.mocked(config.getAgentConfig).mockResolvedValue({
        enabled: true,
        interval: 60000,
        maxRetries: 3,
        retryOnFailure: true,
      });
      await integration.initialize();

      // WHEN - preCommand fires
      const result = await integration.onPreCommand('/oss:build');

      // THEN - Should return task check result
      expect(result).toHaveProperty('hasPendingTasks');
    });
  });
});
