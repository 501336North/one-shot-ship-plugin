/**
 * Agent CLI Commands Tests
 *
 * @behavior Provides CLI commands to manage background agents
 * @acceptance-criteria List, enable/disable, config, status, restart commands work
 * @business-rule Commands update config and control agent lifecycle
 * @boundary Agent CLI
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentCLI } from '../../src/agents/cli';
import { AgentRegistry } from '../../src/agents/registry';
import * as config from '../../src/agents/config';
import type { BackgroundAgent, AgentMetadata, AgentStatus } from '../../src/agents/types';

// Mock dependencies
vi.mock('../../src/agents/registry');
vi.mock('../../src/agents/config');

// Mock agent for testing
const createMockAgent = (name: string): BackgroundAgent => ({
  metadata: {
    name,
    description: `Test ${name} agent`,
    version: '1.0.0',
  },
  initialize: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  poll: vi.fn(),
  getStatus: vi.fn().mockReturnValue({
    isRunning: false,
    lastPollTime: null,
    errorCount: 0,
    lastError: null,
  }),
});

describe('AgentCLI', () => {
  let cli: AgentCLI;
  let mockRegistry: AgentRegistry;

  beforeEach(() => {
    mockRegistry = new AgentRegistry();
    cli = new AgentCLI(mockRegistry);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('list', () => {
    it('should list all registered agents', async () => {
      // GIVEN - Registry has agents
      vi.mocked(mockRegistry.list).mockReturnValue(['pr-monitor', 'code-quality']);
      vi.mocked(mockRegistry.get).mockImplementation((name) => createMockAgent(name));
      vi.mocked(config.getAgentConfig).mockResolvedValue({
        enabled: true,
        interval: 300000,
        maxRetries: 3,
        retryOnFailure: true,
      });

      // WHEN - We list agents
      const result = await cli.list();

      // THEN - Should return agent info
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('pr-monitor');
      expect(result[1].name).toBe('code-quality');
    });

    it('should show enabled/disabled status', async () => {
      // GIVEN - One enabled, one disabled
      vi.mocked(mockRegistry.list).mockReturnValue(['pr-monitor', 'code-quality']);
      vi.mocked(mockRegistry.get).mockImplementation((name) => createMockAgent(name));
      vi.mocked(config.getAgentConfig).mockImplementation(async (name) => ({
        enabled: name === 'pr-monitor',
        interval: 300000,
        maxRetries: 3,
        retryOnFailure: true,
      }));

      // WHEN - We list agents
      const result = await cli.list();

      // THEN - Should show correct enabled status
      expect(result.find((a) => a.name === 'pr-monitor')?.enabled).toBe(true);
      expect(result.find((a) => a.name === 'code-quality')?.enabled).toBe(false);
    });

    it('should show running/stopped state', async () => {
      // GIVEN - One running, one stopped
      vi.mocked(mockRegistry.list).mockReturnValue(['pr-monitor', 'code-quality']);
      const prMonitorAgent = createMockAgent('pr-monitor');
      vi.mocked(prMonitorAgent.getStatus).mockReturnValue({
        isRunning: true,
        lastPollTime: '2025-12-23T12:00:00Z',
        errorCount: 0,
        lastError: null,
      });
      vi.mocked(mockRegistry.get).mockImplementation((name) =>
        name === 'pr-monitor' ? prMonitorAgent : createMockAgent(name)
      );
      vi.mocked(config.getAgentConfig).mockResolvedValue({
        enabled: true,
        interval: 300000,
        maxRetries: 3,
        retryOnFailure: true,
      });

      // WHEN - We list agents
      const result = await cli.list();

      // THEN - Should show correct running state
      expect(result.find((a) => a.name === 'pr-monitor')?.running).toBe(true);
      expect(result.find((a) => a.name === 'code-quality')?.running).toBe(false);
    });
  });

  describe('enable/disable', () => {
    it('should enable agent by writing to config', async () => {
      // GIVEN - Agent exists
      vi.mocked(mockRegistry.has).mockReturnValue(true);
      vi.mocked(config.saveAgentConfig).mockResolvedValue(undefined);
      vi.mocked(mockRegistry.startAgent).mockResolvedValue(undefined);

      // WHEN - We enable agent
      await cli.enable('pr-monitor');

      // THEN - Should update config
      expect(config.saveAgentConfig).toHaveBeenCalledWith('pr-monitor', { enabled: true });
    });

    it('should disable agent by writing to config', async () => {
      // GIVEN - Agent exists
      vi.mocked(mockRegistry.has).mockReturnValue(true);
      vi.mocked(config.saveAgentConfig).mockResolvedValue(undefined);
      vi.mocked(mockRegistry.stopAgent).mockResolvedValue(undefined);

      // WHEN - We disable agent
      await cli.disable('pr-monitor');

      // THEN - Should update config
      expect(config.saveAgentConfig).toHaveBeenCalledWith('pr-monitor', { enabled: false });
    });

    it('should restart agent after enable', async () => {
      // GIVEN - Agent exists
      vi.mocked(mockRegistry.has).mockReturnValue(true);
      vi.mocked(config.saveAgentConfig).mockResolvedValue(undefined);
      vi.mocked(mockRegistry.startAgent).mockResolvedValue(undefined);

      // WHEN - We enable agent
      await cli.enable('pr-monitor');

      // THEN - Should start agent
      expect(mockRegistry.startAgent).toHaveBeenCalledWith('pr-monitor', expect.any(Number));
    });

    it('should stop agent after disable', async () => {
      // GIVEN - Agent exists
      vi.mocked(mockRegistry.has).mockReturnValue(true);
      vi.mocked(config.saveAgentConfig).mockResolvedValue(undefined);
      vi.mocked(mockRegistry.stopAgent).mockResolvedValue(undefined);

      // WHEN - We disable agent
      await cli.disable('pr-monitor');

      // THEN - Should stop agent
      expect(mockRegistry.stopAgent).toHaveBeenCalledWith('pr-monitor');
    });
  });

  describe('config', () => {
    it('should update interval setting', async () => {
      // GIVEN - Agent exists
      vi.mocked(mockRegistry.has).mockReturnValue(true);
      vi.mocked(config.saveAgentConfig).mockResolvedValue(undefined);

      // WHEN - We update interval
      await cli.config('pr-monitor', { interval: '5m' });

      // THEN - Should save config with parsed interval
      expect(config.saveAgentConfig).toHaveBeenCalledWith('pr-monitor', { interval: 300000 });
    });

    it('should validate interval format', async () => {
      // GIVEN - Agent exists
      vi.mocked(mockRegistry.has).mockReturnValue(true);

      // WHEN/THEN - Invalid format should throw
      await expect(cli.config('pr-monitor', { interval: 'invalid' })).rejects.toThrow(
        'Invalid interval format'
      );
    });

    it('should show current config if no options', async () => {
      // GIVEN - Agent exists with config
      vi.mocked(mockRegistry.has).mockReturnValue(true);
      vi.mocked(config.getAgentConfig).mockResolvedValue({
        enabled: true,
        interval: 300000,
        maxRetries: 3,
        retryOnFailure: true,
      });

      // WHEN - We get config
      const result = await cli.config('pr-monitor');

      // THEN - Should return current config
      expect(result).toEqual({
        enabled: true,
        interval: 300000,
        maxRetries: 3,
        retryOnFailure: true,
      });
    });
  });

  describe('status', () => {
    it('should show detailed agent health metrics', async () => {
      // GIVEN - Agent with status
      const mockAgent = createMockAgent('pr-monitor');
      vi.mocked(mockAgent.getStatus).mockReturnValue({
        isRunning: true,
        lastPollTime: '2025-12-23T12:00:00Z',
        errorCount: 2,
        lastError: 'Connection timeout',
      });
      vi.mocked(mockRegistry.get).mockReturnValue(mockAgent);

      // WHEN - We get status
      const result = await cli.status('pr-monitor');

      // THEN - Should return detailed status
      expect(result.isRunning).toBe(true);
      expect(result.lastPollTime).toBe('2025-12-23T12:00:00Z');
      expect(result.errorCount).toBe(2);
      expect(result.lastError).toBe('Connection timeout');
    });

    it('should restart agent by name', async () => {
      // GIVEN - Agent exists
      vi.mocked(mockRegistry.has).mockReturnValue(true);
      vi.mocked(mockRegistry.restartAgent).mockResolvedValue(undefined);
      vi.mocked(config.getAgentConfig).mockResolvedValue({
        enabled: true,
        interval: 300000,
        maxRetries: 3,
        retryOnFailure: true,
      });

      // WHEN - We restart
      await cli.restart('pr-monitor');

      // THEN - Should restart agent
      expect(mockRegistry.restartAgent).toHaveBeenCalledWith('pr-monitor', expect.any(Number));
    });

    it('should show all running agents if no name given', async () => {
      // GIVEN - Multiple agents
      vi.mocked(mockRegistry.list).mockReturnValue(['pr-monitor', 'code-quality']);
      const prMonitor = createMockAgent('pr-monitor');
      vi.mocked(prMonitor.getStatus).mockReturnValue({
        isRunning: true,
        lastPollTime: '2025-12-23T12:00:00Z',
        errorCount: 0,
        lastError: null,
      });
      vi.mocked(mockRegistry.get).mockImplementation((name) =>
        name === 'pr-monitor' ? prMonitor : createMockAgent(name)
      );

      // WHEN - We get all status
      const result = await cli.statusAll();

      // THEN - Should return all statuses
      expect(result).toHaveLength(2);
      expect(result.find((s) => s.name === 'pr-monitor')?.isRunning).toBe(true);
    });
  });
});
