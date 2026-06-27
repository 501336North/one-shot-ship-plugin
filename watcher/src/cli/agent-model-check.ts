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
 * Default proxy port. NOT 3456 — that collides with claude-code-router's default. Resolution
 * precedence: env OSS_PROXY_PORT > config models.proxyPort > default.
 */
const DEFAULT_PROXY_PORT = 8473;

/** Resolve the model-proxy port: env override > config (project>user) > default. */
function resolveProxyPort(
  projectConfig: { models?: { proxyPort?: number } },
  userConfig: { models?: { proxyPort?: number } },
): number {
  const fromEnv = process.env.OSS_PROXY_PORT;
  if (fromEnv && Number.isFinite(Number(fromEnv))) return Number(fromEnv);
  return projectConfig.models?.proxyPort ?? userConfig.models?.proxyPort ?? DEFAULT_PROXY_PORT;
}

/**
 * Result from checking agent model configuration
 */
export interface CheckResult {
  useProxy: boolean;
  model?: string;
  provider?: string;
  proxyUrl?: string;
  /** Human banner the agent prints at the top of its output so the model is visible on every surface. */
  banner?: string;
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
    proxyPort?: number;
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
 * Resolve the plugin root so we can read an agent's own .md frontmatter.
 */
function getPluginRoot(): string {
  return process.env.CLAUDE_PLUGIN_ROOT || path.join(os.homedir(), '.claude', 'plugins', 'oss');
}

/**
 * Read the agent's declared Claude tier from its .md frontmatter (e.g. `model: opus`).
 * Returns undefined when the agent inherits the session model (no model field).
 */
function getAgentFrontmatterModel(agentName: string): string | undefined {
  try {
    const bare = agentName.replace(/^oss:/, '');
    // Defense-in-depth: never let an agent name escape the agents/ dir (in case the caller
    // ever passes dynamic input). Today callers pass a hard-coded literal.
    if (bare.includes('/') || bare.includes('\\') || bare.includes('..')) return undefined;
    const file = path.join(getPluginRoot(), 'agents', `${bare}.md`);
    if (!fs.existsSync(file)) return undefined;
    const content = fs.readFileSync(file, 'utf-8');
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return undefined;
    const line = fm[1].split('\n').find((l) => l.trim().startsWith('model:'));
    if (!line) return undefined;
    // Take everything after the first colon; strip inline comments and surrounding quotes.
    let value = line.slice(line.indexOf(':') + 1).replace(/\s+#.*$/, '').trim();
    value = value.replace(/^["']|["']$/g, '').trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Banner for an agent running on native Claude — shows its declared tier so EVERY agent
 * surfaces its model, not only routed ones.
 */
function nativeClaudeBanner(agentName: string): string {
  const tier = getAgentFrontmatterModel(agentName);
  if (tier) return `🤖 OSS model: ${tier.charAt(0).toUpperCase()}${tier.slice(1)} (claude)`;
  return '🤖 OSS model: Claude (session default)';
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

  // Recursion guard: when OSS_OFFLOAD_ACTIVE=1 we are already inside a nested offload
  // session running on the local model. Re-routing here would spawn offload-within-offload
  // infinitely. Offload is depth-1 only. (AC-OFFLOAD.4)
  if (process.env.OSS_OFFLOAD_ACTIVE === '1') {
    return { useProxy: false };
  }

  // Launcher guard: when OSS_PROXY_ROUTING=1 the session was launched through the OSS proxy
  // (oss-launch), so per-agent routing already happens at the proxy layer for every inherited
  // subagent. The legacy nested-`claude -p` offload must NOT also fire, or it would double-route.
  if (process.env.OSS_PROXY_ROUTING === '1') {
    return { useProxy: false };
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
    return { useProxy: false, banner: nativeClaudeBanner(agentName) };
  }

  // 6. Custom model configured - return proxy info
  // At this point model is guaranteed to be a non-empty string (not undefined, 'claude', or 'default')
  const modelStr = model as string;
  const provider = parseProvider(modelStr);

  const proxyUrl = `http://localhost:${resolveProxyPort(projectConfig, userConfig)}`;

  return {
    useProxy: true,
    model: model,
    provider: provider ?? undefined,
    proxyUrl,
    banner: `🤖 OSS model: ${modelStr}${provider ? ` (${provider})` : ''}`,
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
