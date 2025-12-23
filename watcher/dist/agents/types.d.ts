/**
 * Background Agent Types
 *
 * Core type definitions for the pluggable background agent system.
 * All background agents implement the BackgroundAgent interface.
 */
/**
 * Static metadata about an agent
 */
export interface AgentMetadata {
    name: string;
    description: string;
    version: string;
}
/**
 * Runtime status of an agent
 */
export interface AgentStatus {
    isRunning: boolean;
    lastPollTime: string | null;
    errorCount: number;
    lastError: string | null;
}
/**
 * Configuration for an agent
 */
export interface AgentConfig {
    enabled: boolean;
    interval: number;
    maxRetries: number;
    retryOnFailure: boolean;
    name?: string;
}
/**
 * Default configuration for agents
 */
export declare const DEFAULT_AGENT_CONFIG: AgentConfig;
/**
 * Core interface that all background agents must implement
 */
export interface BackgroundAgent {
    metadata: AgentMetadata;
    initialize(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    poll(): Promise<void>;
    getStatus(): AgentStatus;
}
/**
 * Type guard to check if an object implements BackgroundAgent
 */
export declare function isBackgroundAgent(obj: unknown): obj is BackgroundAgent;
//# sourceMappingURL=types.d.ts.map