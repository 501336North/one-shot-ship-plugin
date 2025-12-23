/**
 * Agent Registry
 *
 * Manages registration and access to background agents.
 * Provides a central place to register, retrieve, and list agents.
 */

import { EventEmitter } from 'events';
import type { BackgroundAgent, AgentStatus } from './types';

/**
 * Agent runtime state
 */
interface AgentRuntime {
  isRunning: boolean;
  interval: NodeJS.Timeout | null;
  lastPollTime: string | null;
  errorCount: number;
  lastError: string | null;
}

/**
 * Error threshold for unhealthy status
 */
const ERROR_THRESHOLD = 3;

/**
 * Registry for managing background agents
 */
export class AgentRegistry extends EventEmitter {
  private agents: Map<string, BackgroundAgent> = new Map();
  private runtimes: Map<string, AgentRuntime> = new Map();

  constructor() {
    super();
  }

  /**
   * Register an agent
   * @throws Error if agent with same name already registered
   */
  register(agent: BackgroundAgent): void {
    const name = agent.metadata.name;

    if (this.agents.has(name)) {
      throw new Error(`Agent "${name}" is already registered`);
    }

    this.agents.set(name, agent);
  }

  /**
   * Get an agent by name
   * @returns The agent or undefined if not found
   */
  get(name: string): BackgroundAgent | undefined {
    return this.agents.get(name);
  }

  /**
   * List all registered agent names
   */
  list(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Check if an agent is registered
   */
  has(name: string): boolean {
    return this.agents.has(name);
  }

  /**
   * Get or create runtime state for an agent
   */
  private getOrCreateRuntime(name: string): AgentRuntime {
    let runtime = this.runtimes.get(name);
    if (!runtime) {
      runtime = {
        isRunning: false,
        interval: null,
        lastPollTime: null,
        errorCount: 0,
        lastError: null,
      };
      this.runtimes.set(name, runtime);
    }
    return runtime;
  }

  /**
   * Start an agent with the given poll interval
   */
  async startAgent(name: string, intervalMs: number): Promise<void> {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent "${name}" not found`);
    }

    const runtime = this.getOrCreateRuntime(name);

    // Initialize and start the agent
    await agent.initialize();
    await agent.start();

    // Set up polling interval
    runtime.isRunning = true;
    runtime.interval = setInterval(async () => {
      try {
        await agent.poll();
        runtime.lastPollTime = new Date().toISOString();
        // Reset error count on successful poll
        if (runtime.errorCount > 0) {
          runtime.errorCount = 0;
          runtime.lastError = null;
          this.emit('agent:healthy', { agentName: name });
        }
      } catch (error) {
        runtime.errorCount++;
        runtime.lastError =
          error instanceof Error ? error.message : String(error);
        // Emit unhealthy event when threshold exceeded
        if (runtime.errorCount >= ERROR_THRESHOLD) {
          this.emit('agent:unhealthy', {
            agentName: name,
            errorCount: runtime.errorCount,
            lastError: runtime.lastError,
          });
        }
      }
    }, intervalMs);
  }

  /**
   * Stop an agent
   */
  async stopAgent(name: string): Promise<void> {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent "${name}" not found`);
    }

    const runtime = this.runtimes.get(name);
    if (runtime) {
      // Clear the polling interval
      if (runtime.interval) {
        clearInterval(runtime.interval);
        runtime.interval = null;
      }
      runtime.isRunning = false;
    }

    await agent.stop();
  }

  /**
   * Restart an agent
   */
  async restartAgent(name: string, intervalMs: number): Promise<void> {
    await this.stopAgent(name);
    await this.startAgent(name, intervalMs);
  }

  /**
   * Get the status of an agent
   */
  getAgentStatus(name: string): AgentStatus | undefined {
    const agent = this.agents.get(name);
    if (!agent) {
      return undefined;
    }

    const runtime = this.runtimes.get(name);
    if (!runtime) {
      return {
        isRunning: false,
        lastPollTime: null,
        errorCount: 0,
        lastError: null,
      };
    }

    return {
      isRunning: runtime.isRunning,
      lastPollTime: runtime.lastPollTime,
      errorCount: runtime.errorCount,
      lastError: runtime.lastError,
    };
  }

  /**
   * Start all registered agents
   */
  async startAll(intervalMs: number): Promise<void> {
    const names = this.list();
    for (const name of names) {
      await this.startAgent(name, intervalMs);
    }
  }

  /**
   * Stop all running agents
   */
  async stopAll(): Promise<void> {
    const names = this.list();
    for (const name of names) {
      const runtime = this.runtimes.get(name);
      if (runtime?.isRunning) {
        await this.stopAgent(name);
      }
    }
  }

  /**
   * Check if an agent is healthy (error count below threshold)
   */
  isHealthy(name: string): boolean {
    const runtime = this.runtimes.get(name);
    if (!runtime) {
      return true; // No runtime means no errors
    }
    return runtime.errorCount < ERROR_THRESHOLD;
  }
}
