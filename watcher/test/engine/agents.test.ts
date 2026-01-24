/**
 * Workflow Engine - Agent Spawner Tests
 *
 * @behavior Agents are spawned based on config with condition evaluation
 * @acceptance-criteria AC-WF-AGENT.1 through AC-WF-AGENT.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  spawnAgent,
  spawnParallelAgents,
  setAgentSpawner,
  resetAgentSpawner,
} from '../../src/engine/agents.js';
import { AgentConfig, WorkflowContext, AgentResult } from '../../src/engine/types.js';

describe('AgentSpawner', () => {
  // Track spawned agents for testing
  const spawnedAgents: string[] = [];
  const mockSpawner = vi.fn(async (agentType: string): Promise<AgentResult> => {
    spawnedAgents.push(agentType);
    return {
      agent: agentType,
      success: true,
      output: `Agent ${agentType} completed successfully`,
    };
  });

  beforeEach(() => {
    // Reset tracking
    spawnedAgents.length = 0;
    mockSpawner.mockClear();
    // Set up mock spawner for testing
    setAgentSpawner(mockSpawner);
  });

  afterEach(() => {
    // Reset to default spawner
    resetAgentSpawner();
  });

  describe('spawnAgent', () => {
    it('should spawn single agent with Task tool', async () => {
      // Arrange
      const config: AgentConfig = {
        agent: 'code-reviewer',
        always: true,
      };
      const context: WorkflowContext = {};

      // Act
      const result = await spawnAgent(config, context);

      // Assert
      expect(mockSpawner).toHaveBeenCalledWith('code-reviewer');
      expect(result.agent).toBe('code-reviewer');
      expect(result.success).toBe(true);
    });

    it('should skip conditional agents when condition false', async () => {
      // Arrange
      const config: AgentConfig = {
        agent: 'frontend-design',
        condition: 'has_ui_work',
      };
      const context: WorkflowContext = {
        changedFiles: ['src/api/routes.ts', 'src/services/user.ts'],
      };

      // Act
      const result = await spawnAgent(config, context);

      // Assert
      expect(mockSpawner).not.toHaveBeenCalled();
      expect(result.agent).toBe('frontend-design');
      expect(result.success).toBe(true);
      expect(result.output).toContain('skipped');
    });

    it('should spawn conditional agents when condition true', async () => {
      // Arrange
      const config: AgentConfig = {
        agent: 'frontend-design',
        condition: 'has_ui_work',
      };
      const context: WorkflowContext = {
        changedFiles: ['src/components/Button.tsx', 'src/styles/button.css'],
      };

      // Act
      const result = await spawnAgent(config, context);

      // Assert
      expect(mockSpawner).toHaveBeenCalledWith('frontend-design');
      expect(result.success).toBe(true);
    });

    it('should handle agent errors gracefully', async () => {
      // Arrange
      const errorSpawner = vi.fn(async (): Promise<AgentResult> => {
        throw new Error('Agent failed to start');
      });
      setAgentSpawner(errorSpawner);

      const config: AgentConfig = {
        agent: 'failing-agent',
        always: true,
      };
      const context: WorkflowContext = {};

      // Act
      const result = await spawnAgent(config, context);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent failed to start');
    });
  });

  describe('spawnParallelAgents', () => {
    it('should spawn parallel agents for quality gates', async () => {
      // Arrange
      const configs: AgentConfig[] = [
        { agent: 'code-reviewer', always: true },
        { agent: 'performance-engineer', always: true },
        { agent: 'security-auditor', always: true },
      ];
      const context: WorkflowContext = {};

      // Act
      const results = await spawnParallelAgents(configs, context, true);

      // Assert
      expect(mockSpawner).toHaveBeenCalledTimes(3);
      expect(spawnedAgents).toContain('code-reviewer');
      expect(spawnedAgents).toContain('performance-engineer');
      expect(spawnedAgents).toContain('security-auditor');
      expect(results).toHaveLength(3);
    });

    it('should aggregate results from multiple agents', async () => {
      // Arrange
      const customSpawner = vi.fn(async (agentType: string): Promise<AgentResult> => {
        return {
          agent: agentType,
          success: true,
          output: `Output from ${agentType}`,
        };
      });
      setAgentSpawner(customSpawner);

      const configs: AgentConfig[] = [
        { agent: 'agent-1', always: true },
        { agent: 'agent-2', always: true },
      ];
      const context: WorkflowContext = {};

      // Act
      const results = await spawnParallelAgents(configs, context, false);

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0].agent).toBe('agent-1');
      expect(results[0].output).toBe('Output from agent-1');
      expect(results[1].agent).toBe('agent-2');
      expect(results[1].output).toBe('Output from agent-2');
    });

    it('should respect all_must_pass flag when all pass', async () => {
      // Arrange
      const configs: AgentConfig[] = [
        { agent: 'passing-agent-1', always: true },
        { agent: 'passing-agent-2', always: true },
      ];
      const context: WorkflowContext = {};

      // Act
      const results = await spawnParallelAgents(configs, context, true);

      // Assert
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('should respect all_must_pass flag when one fails', async () => {
      // Arrange
      const mixedSpawner = vi.fn(async (agentType: string): Promise<AgentResult> => {
        if (agentType === 'failing-agent') {
          return {
            agent: agentType,
            success: false,
            error: 'Agent found issues',
          };
        }
        return {
          agent: agentType,
          success: true,
          output: 'All good',
        };
      });
      setAgentSpawner(mixedSpawner);

      const configs: AgentConfig[] = [
        { agent: 'passing-agent', always: true },
        { agent: 'failing-agent', always: true },
      ];
      const context: WorkflowContext = {};

      // Act
      const results = await spawnParallelAgents(configs, context, true);

      // Assert
      expect(results.some((r) => !r.success)).toBe(true);
      const failedResult = results.find((r) => r.agent === 'failing-agent');
      expect(failedResult?.success).toBe(false);
    });

    it('should skip conditional agents in parallel execution', async () => {
      // Arrange
      const configs: AgentConfig[] = [
        { agent: 'code-reviewer', always: true },
        { agent: 'frontend-design', condition: 'has_ui_work' },
      ];
      const context: WorkflowContext = {
        changedFiles: ['src/api/routes.ts'],
      };

      // Act
      const results = await spawnParallelAgents(configs, context, false);

      // Assert
      expect(results).toHaveLength(2);
      const frontendResult = results.find((r) => r.agent === 'frontend-design');
      expect(frontendResult?.output).toContain('skipped');
      expect(mockSpawner).toHaveBeenCalledTimes(1);
      expect(mockSpawner).toHaveBeenCalledWith('code-reviewer');
    });

    it('should handle empty configs array', async () => {
      // Arrange
      const configs: AgentConfig[] = [];
      const context: WorkflowContext = {};

      // Act
      const results = await spawnParallelAgents(configs, context, true);

      // Assert
      expect(results).toEqual([]);
      expect(mockSpawner).not.toHaveBeenCalled();
    });
  });
});
