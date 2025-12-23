/**
 * Agent CLI Commands
 *
 * Provides CLI commands to manage background agents.
 */
import { getAgentConfig, saveAgentConfig } from './config';
/**
 * Default polling interval (5 minutes)
 */
const DEFAULT_INTERVAL = 300000;
/**
 * Parse interval string to milliseconds
 */
function parseInterval(interval) {
    const match = interval.match(/^(\d+)(s|m|h)$/);
    if (!match) {
        throw new Error('Invalid interval format. Use format like "30s", "5m", "1h"');
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
        case 's':
            return value * 1000;
        case 'm':
            return value * 60 * 1000;
        case 'h':
            return value * 60 * 60 * 1000;
        default:
            throw new Error('Invalid interval format');
    }
}
/**
 * Agent CLI
 *
 * Provides commands to manage background agents.
 */
export class AgentCLI {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    /**
     * List all registered agents with their status
     */
    async list() {
        const agentNames = this.registry.list();
        const entries = [];
        for (const name of agentNames) {
            const agent = this.registry.get(name);
            if (!agent)
                continue;
            const config = await getAgentConfig(name);
            const status = agent.getStatus();
            entries.push({
                name,
                description: agent.metadata.description,
                enabled: config.enabled,
                running: status.isRunning,
                lastPollTime: status.lastPollTime,
            });
        }
        return entries;
    }
    /**
     * Enable an agent
     */
    async enable(agentName) {
        if (!this.registry.has(agentName)) {
            throw new Error(`Agent '${agentName}' not found`);
        }
        await saveAgentConfig(agentName, { enabled: true });
        await this.registry.startAgent(agentName, DEFAULT_INTERVAL);
    }
    /**
     * Disable an agent
     */
    async disable(agentName) {
        if (!this.registry.has(agentName)) {
            throw new Error(`Agent '${agentName}' not found`);
        }
        await saveAgentConfig(agentName, { enabled: false });
        await this.registry.stopAgent(agentName);
    }
    /**
     * Get or update agent config
     */
    async config(agentName, options) {
        if (!this.registry.has(agentName)) {
            throw new Error(`Agent '${agentName}' not found`);
        }
        // If no options, return current config
        if (!options || Object.keys(options).length === 0) {
            return getAgentConfig(agentName);
        }
        // Update config
        if (options.interval) {
            const intervalMs = parseInterval(options.interval);
            await saveAgentConfig(agentName, { interval: intervalMs });
        }
    }
    /**
     * Get detailed status for an agent
     */
    async status(agentName) {
        const agent = this.registry.get(agentName);
        if (!agent) {
            throw new Error(`Agent '${agentName}' not found`);
        }
        return agent.getStatus();
    }
    /**
     * Get status for all agents
     */
    async statusAll() {
        const agentNames = this.registry.list();
        const statuses = [];
        for (const name of agentNames) {
            const agent = this.registry.get(name);
            if (!agent)
                continue;
            const status = agent.getStatus();
            statuses.push({
                name,
                ...status,
            });
        }
        return statuses;
    }
    /**
     * Restart an agent
     */
    async restart(agentName) {
        if (!this.registry.has(agentName)) {
            throw new Error(`Agent '${agentName}' not found`);
        }
        const config = await getAgentConfig(agentName);
        await this.registry.restartAgent(agentName, config.interval || DEFAULT_INTERVAL);
    }
}
//# sourceMappingURL=cli.js.map