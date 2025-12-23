/**
 * Background Agent Types
 *
 * Core type definitions for the pluggable background agent system.
 * All background agents implement the BackgroundAgent interface.
 */
/**
 * Default configuration for agents
 */
export const DEFAULT_AGENT_CONFIG = {
    enabled: false,
    interval: 300000, // 5 minutes
    maxRetries: 3,
    retryOnFailure: true,
};
/**
 * Type guard to check if an object implements BackgroundAgent
 */
export function isBackgroundAgent(obj) {
    if (!obj || typeof obj !== 'object') {
        return false;
    }
    const agent = obj;
    // Check metadata
    if (!agent.metadata || typeof agent.metadata !== 'object') {
        return false;
    }
    const metadata = agent.metadata;
    if (typeof metadata.name !== 'string' ||
        typeof metadata.description !== 'string' ||
        typeof metadata.version !== 'string') {
        return false;
    }
    // Check required methods
    if (typeof agent.initialize !== 'function' ||
        typeof agent.start !== 'function' ||
        typeof agent.stop !== 'function' ||
        typeof agent.poll !== 'function' ||
        typeof agent.getStatus !== 'function') {
        return false;
    }
    return true;
}
//# sourceMappingURL=types.js.map