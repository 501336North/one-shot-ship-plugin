/**
 * Watcher-Agent Integration
 *
 * Integrates background agents with the watcher lifecycle.
 * Handles SessionStart, preCommand, and session end events.
 */

import type { AgentRegistry } from '../agents/registry';
import { PRMonitorAgent } from '../agents/pr-monitor';
import { PRMonitorState } from '../agents/pr-monitor-state';
import { GitHubClient } from '../agents/github-client';
import { getAgentConfig } from '../agents/config';

/**
 * Result of pre-command check
 */
export interface PreCommandResult {
  hasPendingTasks: boolean;
  taskCount: number;
}

/**
 * Watcher-Agent Integration
 *
 * Manages agent lifecycle within the watcher context.
 */
export class WatcherAgentIntegration {
  private initialized = false;

  constructor(private registry: AgentRegistry) {}

  /**
   * Initialize integration and register agents
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create and register PR Monitor Agent
    const state = new PRMonitorState();
    const client = new GitHubClient();
    const prMonitorAgent = new PRMonitorAgent(state, client);

    this.registry.register(prMonitorAgent);
    await prMonitorAgent.initialize();

    this.initialized = true;

    // Auto-start enabled agents
    for (const name of this.registry.list()) {
      const config = await getAgentConfig(name);
      if (config.enabled) {
        await this.registry.startAgent(name, config.interval);
      }
    }
  }

  /**
   * Handle SessionStart hook
   */
  async onSessionStart(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Start all enabled agents
    for (const name of this.registry.list()) {
      const config = await getAgentConfig(name);
      if (config.enabled) {
        await this.registry.startAgent(name, config.interval);
      }
    }
  }

  /**
   * Handle session end
   */
  async onSessionEnd(): Promise<void> {
    await this.registry.stopAll();
  }

  /**
   * Handle preCommand hook
   */
  async onPreCommand(command: string): Promise<PreCommandResult> {
    // Check for pending PR tasks
    const prMonitor = this.registry.get('pr-monitor') as PRMonitorAgent | undefined;

    if (!prMonitor) {
      return { hasPendingTasks: false, taskCount: 0 };
    }

    const tasks = prMonitor.getQueuedTasks();
    return {
      hasPendingTasks: tasks.length > 0,
      taskCount: tasks.length,
    };
  }
}
