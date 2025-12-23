/**
 * Agent CLI Commands
 *
 * Provides CLI commands to manage background agents.
 */
import type { AgentRegistry } from './registry';
import type { AgentConfig, AgentStatus } from './types';
/**
 * Agent list entry
 */
export interface AgentListEntry {
    name: string;
    description: string;
    enabled: boolean;
    running: boolean;
    lastPollTime: string | null;
}
/**
 * Agent status with name
 */
export interface AgentStatusWithName extends AgentStatus {
    name: string;
}
/**
 * Agent CLI
 *
 * Provides commands to manage background agents.
 */
export declare class AgentCLI {
    private registry;
    constructor(registry: AgentRegistry);
    /**
     * List all registered agents with their status
     */
    list(): Promise<AgentListEntry[]>;
    /**
     * Enable an agent
     */
    enable(agentName: string): Promise<void>;
    /**
     * Disable an agent
     */
    disable(agentName: string): Promise<void>;
    /**
     * Get or update agent config
     */
    config(agentName: string, options?: {
        interval?: string;
    }): Promise<AgentConfig | void>;
    /**
     * Get detailed status for an agent
     */
    status(agentName: string): Promise<AgentStatus>;
    /**
     * Get status for all agents
     */
    statusAll(): Promise<AgentStatusWithName[]>;
    /**
     * Restart an agent
     */
    restart(agentName: string): Promise<void>;
}
//# sourceMappingURL=cli.d.ts.map