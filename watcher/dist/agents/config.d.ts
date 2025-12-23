/**
 * Agent Configuration
 *
 * Handles loading and merging agent configurations from global and project sources.
 * Project configs take precedence over global configs.
 */
import { AgentConfig } from './types';
/**
 * Configuration for all agents
 */
export interface AgentsConfig {
    agents: Record<string, AgentConfig>;
}
/**
 * Load global config from ~/.oss/agents.json
 */
export declare function loadGlobalConfig(): Promise<AgentsConfig>;
/**
 * Load project config from .oss/agents.json
 */
export declare function loadProjectConfig(): Promise<AgentsConfig>;
/**
 * Merge global and project configs, with project taking precedence
 */
export declare function mergeConfigs(globalConfig: AgentsConfig, projectConfig: AgentsConfig): AgentsConfig;
/**
 * Get merged config for a specific agent
 */
export declare function getAgentConfig(agentName: string): Promise<AgentConfig>;
/**
 * Save agent config to project .oss/agents.json
 */
export declare function saveAgentConfig(agentName: string, updates: Partial<AgentConfig>): Promise<void>;
//# sourceMappingURL=config.d.ts.map