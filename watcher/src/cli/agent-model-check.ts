#!/usr/bin/env node
/**
 * Agent Model Check CLI
 *
 * Called by agent prompts to determine if custom model routing is configured.
 *
 * @behavior Checks if a custom model is configured for an agent
 * @acceptance-criteria AC-AMC.1 through AC-AMC.7
 *
 * Usage:
 *   node agent-model-check.js --agent <agent-name>
 *   node agent-model-check.js --agent <agent-name> --task "task description"
 *   node agent-model-check.js --agent <agent-name> --project "/path/to/project"
 *
 * Output (JSON):
 *   { "useProxy": false } - Use native Claude
 *   { "useProxy": true, "model": "ollama/codellama", "provider": "ollama", "proxyUrl": "http://localhost:3456" }
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseProvider } from '../types/model-settings.js';

/**
 * Proxy URL for model routing
 */
const PROXY_URL = 'http://localhost:3456';

/**
 * Result from checking agent model configuration
 */
export interface CheckResult {
  useProxy: boolean;
  model?: string;
  provider?: string;
  proxyUrl?: string;
}

/**
 * Parameters for checking agent model
 */
export interface CheckAgentModelParams {
  agentName: string;
  projectDir: string;
  task?: string;
}

/**
 * Parsed CLI arguments
 */
export interface ParsedArgs {
  agentName: string;
  task?: string;
  projectDir: string;
}

/**
 * Raw config structure
 */
interface RawConfig {
  models?: {
    default?: string;
    agents?: Record<string, string>;
    commands?: Record<string, string>;
    skills?: Record<string, string>;
    hooks?: Record<string, string>;
  };
}

/**
 * Load config from file path
 */
function loadConfigFromFile(configPath: string): RawConfig {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Return empty config on error (malformed JSON, etc.)
  }
  return {};
}

/**
 * Get user config directory
 */
function getUserConfigDir(): string {
  return path.join(os.homedir(), '.oss');
}

/**
 * Check if a model identifier means "use native Claude"
 */
function isNativeClaudeModel(model: string | undefined): boolean {
  return !model || model === 'claude' || model === 'default';
}

/**
 * Check if custom model is configured for an agent
 */
export async function checkAgentModel(params: CheckAgentModelParams): Promise<CheckResult> {
  const { agentName, projectDir } = params;

  // Validate agent name
  if (!agentName) {
    throw new Error('--agent is required');
  }

  // Load configs with precedence: Project > User
  const userConfigPath = path.join(getUserConfigDir(), 'config.json');
  const projectConfigPath = path.join(projectDir, '.oss', 'config.json');

  const userConfig = loadConfigFromFile(userConfigPath);
  const projectConfig = loadConfigFromFile(projectConfigPath);

  // 1. Check project config first (highest precedence)
  let model = projectConfig.models?.agents?.[agentName];

  // 2. Fall back to user config
  if (!model) {
    model = userConfig.models?.agents?.[agentName];
  }

  // 3. Fall back to project global default
  if (!model) {
    model = projectConfig.models?.default;
  }

  // 4. Fall back to user global default
  if (!model) {
    model = userConfig.models?.default;
  }

  // 5. If no model or native Claude, return useProxy: false
  if (isNativeClaudeModel(model)) {
    return { useProxy: false };
  }

  // 6. Custom model configured - return proxy info
  // At this point model is guaranteed to be a non-empty string (not undefined, 'claude', or 'default')
  const modelStr = model as string;
  const provider = parseProvider(modelStr);

  return {
    useProxy: true,
    model: model,
    provider: provider ?? undefined,
    proxyUrl: PROXY_URL,
  };
}

/**
 * Parse CLI arguments
 */
export function parseCliArgs(args: string[]): ParsedArgs {
  let agentName = '';
  let task: string | undefined;
  let projectDir = process.cwd();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1]) {
      agentName = args[++i];
    } else if (args[i] === '--task' && args[i + 1]) {
      task = args[++i];
    } else if (args[i] === '--project' && args[i + 1]) {
      projectDir = args[++i];
    }
  }

  return {
    agentName,
    task,
    projectDir,
  };
}

/**
 * Format output as JSON string
 */
export function formatOutput(result: CheckResult): string {
  return JSON.stringify(result);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parsedArgs = parseCliArgs(args);

  if (!parsedArgs.agentName) {
    console.error(JSON.stringify({ error: '--agent is required' }));
    process.exit(1);
  }

  try {
    const result = await checkAgentModel({
      agentName: parsedArgs.agentName,
      projectDir: parsedArgs.projectDir,
      task: parsedArgs.task,
    });

    console.log(formatOutput(result));
  } catch (err) {
    console.error(JSON.stringify({ error: (err as Error).message }));
    process.exit(1);
  }
}

// Main execution - only run when called directly
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('agent-model-check.js');

if (isMainModule) {
  main().catch(console.error);
}
