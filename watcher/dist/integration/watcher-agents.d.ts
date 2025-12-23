/**
 * Watcher-Agent Integration
 *
 * Integrates background agents with the watcher lifecycle.
 * Handles SessionStart, preCommand, and session end events.
 */
import type { AgentRegistry } from '../agents/registry';
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
export declare class WatcherAgentIntegration {
    private registry;
    private initialized;
    constructor(registry: AgentRegistry);
    /**
     * Initialize integration and register agents
     */
    initialize(): Promise<void>;
    /**
     * Handle SessionStart hook
     */
    onSessionStart(): Promise<void>;
    /**
     * Handle session end
     */
    onSessionEnd(): Promise<void>;
    /**
     * Handle preCommand hook
     */
    onPreCommand(command: string): Promise<PreCommandResult>;
}
//# sourceMappingURL=watcher-agents.d.ts.map