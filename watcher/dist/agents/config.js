/**
 * Agent Configuration
 *
 * Handles loading and merging agent configurations from global and project sources.
 * Project configs take precedence over global configs.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { DEFAULT_AGENT_CONFIG } from './types';
const EMPTY_CONFIG = { agents: {} };
/**
 * Validate agent name (alphanumeric, hyphens, underscores only)
 */
function validateAgentName(name) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new Error(`Invalid agent name: ${name}`);
    }
}
/**
 * Check if a file exists
 */
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Load global config from ~/.oss/agents.json
 */
export async function loadGlobalConfig() {
    const globalPath = path.join(homedir(), '.oss', 'agents.json');
    if (!(await fileExists(globalPath))) {
        return EMPTY_CONFIG;
    }
    try {
        const content = await fs.readFile(globalPath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return EMPTY_CONFIG;
    }
}
/**
 * Load project config from .oss/agents.json
 */
export async function loadProjectConfig() {
    const projectPath = path.join(process.cwd(), '.oss', 'agents.json');
    if (!(await fileExists(projectPath))) {
        return EMPTY_CONFIG;
    }
    try {
        const content = await fs.readFile(projectPath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return EMPTY_CONFIG;
    }
}
/**
 * Merge global and project configs, with project taking precedence
 */
export function mergeConfigs(globalConfig, projectConfig) {
    const merged = { agents: {} };
    // Start with global config
    for (const [name, config] of Object.entries(globalConfig.agents)) {
        merged.agents[name] = { ...config };
    }
    // Override with project config
    for (const [name, config] of Object.entries(projectConfig.agents)) {
        merged.agents[name] = {
            ...merged.agents[name],
            ...config,
        };
    }
    return merged;
}
/**
 * Get merged config for a specific agent
 */
export async function getAgentConfig(agentName) {
    validateAgentName(agentName);
    const globalConfig = await loadGlobalConfig();
    const projectConfig = await loadProjectConfig();
    const merged = mergeConfigs(globalConfig, projectConfig);
    // Return agent config or defaults
    return merged.agents[agentName] || { ...DEFAULT_AGENT_CONFIG };
}
/**
 * Save agent config to project .oss/agents.json
 */
export async function saveAgentConfig(agentName, updates) {
    validateAgentName(agentName);
    const projectPath = path.join(process.cwd(), '.oss', 'agents.json');
    // Load existing project config
    let projectConfig = await loadProjectConfig();
    // Ensure agents object exists
    if (!projectConfig.agents) {
        projectConfig = { agents: {} };
    }
    // Merge updates with existing agent config
    projectConfig.agents[agentName] = {
        ...projectConfig.agents[agentName],
        ...updates,
    };
    // Ensure .oss directory exists
    const ossDir = path.join(process.cwd(), '.oss');
    try {
        await fs.mkdir(ossDir, { recursive: true });
    }
    catch {
        // Directory may already exist
    }
    // Write config
    await fs.writeFile(projectPath, JSON.stringify(projectConfig, null, 2));
}
//# sourceMappingURL=config.js.map