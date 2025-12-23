/**
 * Agent Registry
 *
 * Manages registration and access to background agents.
 * Provides a central place to register, retrieve, and list agents.
 */
import { EventEmitter } from 'events';
import type { BackgroundAgent, AgentStatus } from './types';
/**
 * Registry for managing background agents
 */
export declare class AgentRegistry extends EventEmitter {
    private agents;
    private runtimes;
    constructor();
    /**
     * Register an agent
     * @throws Error if agent with same name already registered
     */
    register(agent: BackgroundAgent): void;
    /**
     * Get an agent by name
     * @returns The agent or undefined if not found
     */
    get(name: string): BackgroundAgent | undefined;
    /**
     * List all registered agent names
     */
    list(): string[];
    /**
     * Check if an agent is registered
     */
    has(name: string): boolean;
    /**
     * Get or create runtime state for an agent
     */
    private getOrCreateRuntime;
    /**
     * Start an agent with the given poll interval
     */
    startAgent(name: string, intervalMs: number): Promise<void>;
    /**
     * Stop an agent
     */
    stopAgent(name: string): Promise<void>;
    /**
     * Restart an agent
     */
    restartAgent(name: string, intervalMs: number): Promise<void>;
    /**
     * Get the status of an agent
     */
    getAgentStatus(name: string): AgentStatus | undefined;
    /**
     * Start all registered agents
     */
    startAll(intervalMs: number): Promise<void>;
    /**
     * Stop all running agents
     */
    stopAll(): Promise<void>;
    /**
     * Check if an agent is healthy (error count below threshold)
     */
    isHealthy(name: string): boolean;
}
//# sourceMappingURL=registry.d.ts.map