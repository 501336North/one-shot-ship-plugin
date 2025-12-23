/**
 * AgentRegistry Tests
 *
 * @behavior Registry manages agent lifecycle and provides access to agents
 * @acceptance-criteria Agents can be registered, retrieved, and listed
 * @business-rule No duplicate agent names allowed
 * @boundary Agent registry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentRegistry } from '../../src/agents/registry';
import type { BackgroundAgent, AgentStatus } from '../../src/agents/types';

// Helper to create a mock agent
function createMockAgent(name: string): BackgroundAgent {
  return {
    metadata: {
      name,
      description: `Test agent ${name}`,
      version: '1.0.0',
    },
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    poll: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue({
      isRunning: false,
      lastPollTime: null,
      errorCount: 0,
      lastError: null,
    } as AgentStatus),
  };
}

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('should register an agent by name', () => {
      // GIVEN - A mock agent
      const agent = createMockAgent('test-agent');

      // WHEN - We register the agent
      registry.register(agent);

      // THEN - Agent should be retrievable
      expect(registry.has('test-agent')).toBe(true);
    });

    it('should prevent duplicate agent registration', () => {
      // GIVEN - An agent is already registered
      const agent1 = createMockAgent('duplicate');
      const agent2 = createMockAgent('duplicate');
      registry.register(agent1);

      // WHEN/THEN - Registering again should throw
      expect(() => registry.register(agent2)).toThrow(
        'Agent "duplicate" is already registered'
      );
    });
  });

  describe('get', () => {
    it('should get agent by name', () => {
      // GIVEN - A registered agent
      const agent = createMockAgent('my-agent');
      registry.register(agent);

      // WHEN - We get the agent
      const result = registry.get('my-agent');

      // THEN - Should return the agent
      expect(result).toBe(agent);
    });

    it('should return undefined for unknown agent', () => {
      // WHEN - We get an unregistered agent
      const result = registry.get('unknown');

      // THEN - Should return undefined
      expect(result).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should list all registered agents', () => {
      // GIVEN - Multiple registered agents
      registry.register(createMockAgent('agent-a'));
      registry.register(createMockAgent('agent-b'));
      registry.register(createMockAgent('agent-c'));

      // WHEN - We list agents
      const result = registry.list();

      // THEN - Should return all agent names
      expect(result).toContain('agent-a');
      expect(result).toContain('agent-b');
      expect(result).toContain('agent-c');
      expect(result).toHaveLength(3);
    });

    it('should return empty array when no agents registered', () => {
      // WHEN - We list agents on empty registry
      const result = registry.list();

      // THEN - Should return empty array
      expect(result).toEqual([]);
    });
  });

  describe('has', () => {
    it('should return true for registered agent', () => {
      // GIVEN - A registered agent
      registry.register(createMockAgent('existing'));

      // WHEN - We check if it exists
      const result = registry.has('existing');

      // THEN - Should return true
      expect(result).toBe(true);
    });

    it('should return false for unregistered agent', () => {
      // WHEN - We check for unknown agent
      const result = registry.has('unknown');

      // THEN - Should return false
      expect(result).toBe(false);
    });
  });

  describe('startAgent', () => {
    it('should initialize agent before starting', async () => {
      // GIVEN - A registered agent
      const agent = createMockAgent('test-agent');
      registry.register(agent);

      // WHEN - We start the agent
      await registry.startAgent('test-agent', 60000);

      // THEN - Initialize should be called first
      expect(agent.initialize).toHaveBeenCalled();
      expect(agent.start).toHaveBeenCalled();
    });

    it('should start agent with configured interval', async () => {
      // GIVEN - A registered agent
      const agent = createMockAgent('test-agent');
      registry.register(agent);

      // WHEN - We start the agent with interval
      await registry.startAgent('test-agent', 100);

      // THEN - Agent should start polling (we'll check status)
      const status = registry.getAgentStatus('test-agent');
      expect(status?.isRunning).toBe(true);

      // Cleanup
      await registry.stopAgent('test-agent');
    });

    it('should throw if agent not found', async () => {
      // WHEN/THEN - Starting unknown agent should throw
      await expect(registry.startAgent('unknown', 1000)).rejects.toThrow(
        'Agent "unknown" not found'
      );
    });
  });

  describe('stopAgent', () => {
    it('should stop agent and clear interval', async () => {
      // GIVEN - A running agent
      const agent = createMockAgent('test-agent');
      registry.register(agent);
      await registry.startAgent('test-agent', 100);

      // WHEN - We stop the agent
      await registry.stopAgent('test-agent');

      // THEN - Agent should be stopped
      expect(agent.stop).toHaveBeenCalled();
      const status = registry.getAgentStatus('test-agent');
      expect(status?.isRunning).toBe(false);
    });
  });

  describe('restartAgent', () => {
    it('should restart agent (stop then start)', async () => {
      // GIVEN - A running agent
      const agent = createMockAgent('test-agent');
      registry.register(agent);
      await registry.startAgent('test-agent', 100);

      // WHEN - We restart the agent
      await registry.restartAgent('test-agent', 100);

      // THEN - Agent should have been stopped and started
      expect(agent.stop).toHaveBeenCalled();
      expect(agent.start).toHaveBeenCalledTimes(2);

      // Cleanup
      await registry.stopAgent('test-agent');
    });
  });

  describe('getAgentStatus', () => {
    it('should track agent running state', async () => {
      // GIVEN - A registered agent
      const agent = createMockAgent('test-agent');
      registry.register(agent);

      // WHEN - Agent is not started
      const statusBefore = registry.getAgentStatus('test-agent');

      // THEN - Should show not running
      expect(statusBefore?.isRunning).toBe(false);

      // WHEN - Agent is started
      await registry.startAgent('test-agent', 100);
      const statusAfter = registry.getAgentStatus('test-agent');

      // THEN - Should show running
      expect(statusAfter?.isRunning).toBe(true);

      // Cleanup
      await registry.stopAgent('test-agent');
    });

    it('should return undefined for unknown agent', () => {
      // WHEN - We get status for unknown agent
      const status = registry.getAgentStatus('unknown');

      // THEN - Should return undefined
      expect(status).toBeUndefined();
    });
  });

  describe('startAll and stopAll', () => {
    it('should start all registered agents', async () => {
      // GIVEN - Multiple registered agents
      const agent1 = createMockAgent('agent-1');
      const agent2 = createMockAgent('agent-2');
      registry.register(agent1);
      registry.register(agent2);

      // WHEN - We start all
      await registry.startAll(100);

      // THEN - All should be running
      expect(registry.getAgentStatus('agent-1')?.isRunning).toBe(true);
      expect(registry.getAgentStatus('agent-2')?.isRunning).toBe(true);

      // Cleanup
      await registry.stopAll();
    });

    it('should stop all running agents', async () => {
      // GIVEN - Multiple running agents
      const agent1 = createMockAgent('agent-1');
      const agent2 = createMockAgent('agent-2');
      registry.register(agent1);
      registry.register(agent2);
      await registry.startAll(100);

      // WHEN - We stop all
      await registry.stopAll();

      // THEN - All should be stopped
      expect(registry.getAgentStatus('agent-1')?.isRunning).toBe(false);
      expect(registry.getAgentStatus('agent-2')?.isRunning).toBe(false);
    });
  });

  describe('Health Monitoring', () => {
    it('should track consecutive errors per agent', async () => {
      // GIVEN - An agent that fails on poll
      const agent = createMockAgent('failing-agent');
      const error = new Error('Poll failed');
      vi.mocked(agent.poll).mockRejectedValue(error);
      registry.register(agent);

      // WHEN - We start and let it poll
      await registry.startAgent('failing-agent', 10);
      await new Promise((r) => setTimeout(r, 50)); // Wait for a few polls

      // THEN - Error count should increase
      const status = registry.getAgentStatus('failing-agent');
      expect(status?.errorCount).toBeGreaterThan(0);
      expect(status?.lastError).toBe('Poll failed');

      // Cleanup
      await registry.stopAgent('failing-agent');
    });

    it('should reset error count on successful poll', async () => {
      // GIVEN - Agent that fails once then succeeds
      const agent = createMockAgent('recovering-agent');
      let callCount = 0;
      vi.mocked(agent.poll).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First poll failed');
        }
        // Subsequent calls succeed
      });
      registry.register(agent);

      // WHEN - We start and poll fails then succeeds
      await registry.startAgent('recovering-agent', 10);
      await new Promise((r) => setTimeout(r, 50)); // Wait for multiple polls

      // THEN - Error count should be reset
      const status = registry.getAgentStatus('recovering-agent');
      expect(status?.errorCount).toBe(0);

      // Cleanup
      await registry.stopAgent('recovering-agent');
    });

    it('should emit event when agent exceeds error threshold', async () => {
      // GIVEN - Agent that keeps failing
      const agent = createMockAgent('unhealthy-agent');
      vi.mocked(agent.poll).mockRejectedValue(new Error('Always fails'));
      registry.register(agent);

      // Set up event listener
      const events: Array<{ agentName: string; errorCount: number }> = [];
      registry.on('agent:unhealthy', (data) => events.push(data));

      // WHEN - We start and let errors accumulate (threshold is 3)
      await registry.startAgent('unhealthy-agent', 10);
      await new Promise((r) => setTimeout(r, 100)); // Wait for enough failures

      // THEN - Event should have been emitted
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].agentName).toBe('unhealthy-agent');

      // Cleanup
      await registry.stopAgent('unhealthy-agent');
    });

    it('should check if agent is healthy', async () => {
      // GIVEN - A healthy agent
      const agent = createMockAgent('healthy-agent');
      registry.register(agent);
      await registry.startAgent('healthy-agent', 100);

      // WHEN - We check health
      const isHealthy = registry.isHealthy('healthy-agent');

      // THEN - Should be healthy
      expect(isHealthy).toBe(true);

      // Cleanup
      await registry.stopAgent('healthy-agent');
    });

    it('should report unhealthy when error count exceeds threshold', async () => {
      // GIVEN - Agent with high error count
      const agent = createMockAgent('bad-agent');
      vi.mocked(agent.poll).mockRejectedValue(new Error('Always fails'));
      registry.register(agent);
      await registry.startAgent('bad-agent', 10);

      // Wait for errors to accumulate past threshold
      await new Promise((r) => setTimeout(r, 100));

      // WHEN - We check health
      const isHealthy = registry.isHealthy('bad-agent');

      // THEN - Should be unhealthy
      expect(isHealthy).toBe(false);

      // Cleanup
      await registry.stopAgent('bad-agent');
    });
  });
});
