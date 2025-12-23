/**
 * Watcher-Agent Integration
 *
 * Integrates background agents with the watcher lifecycle.
 * Handles SessionStart, preCommand, and session end events.
 */
import { PRMonitorAgent } from '../agents/pr-monitor';
import { PRMonitorState } from '../agents/pr-monitor-state';
import { GitHubClient } from '../agents/github-client';
import { getAgentConfig } from '../agents/config';
/**
 * Watcher-Agent Integration
 *
 * Manages agent lifecycle within the watcher context.
 */
export class WatcherAgentIntegration {
    registry;
    initialized = false;
    constructor(registry) {
        this.registry = registry;
    }
    /**
     * Initialize integration and register agents
     */
    async initialize() {
        if (this.initialized)
            return;
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
    async onSessionStart() {
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
    async onSessionEnd() {
        await this.registry.stopAll();
    }
    /**
     * Handle preCommand hook
     */
    async onPreCommand(command) {
        // Check for pending PR tasks
        const prMonitor = this.registry.get('pr-monitor');
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
//# sourceMappingURL=watcher-agents.js.map