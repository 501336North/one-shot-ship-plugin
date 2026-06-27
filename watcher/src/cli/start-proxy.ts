#!/usr/bin/env node
/**
 * Start Proxy CLI
 *
 * Called by agents to start the ModelProxy server for custom model routing.
 *
 * @behavior Starts ModelProxy server on localhost for routing requests to providers
 * @acceptance-criteria AC-SP.1 through AC-SP.18
 *
 * Usage:
 *   npx tsx src/cli/start-proxy.ts --model ollama/codellama
 *   npx tsx src/cli/start-proxy.ts --model ollama/codellama --port 3457
 *   npx tsx src/cli/start-proxy.ts --model openrouter/claude-3-haiku --api-key sk-or-xxx
 *   npx tsx src/cli/start-proxy.ts --model ollama/codellama --background
 *
 * Output (JSON):
 *   {"port": 3456, "pid": 12345, "model": "ollama/codellama", "background": false}
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { ModelProxy } from '../services/model-proxy.js';

// ============================================================================
// Constants
// ============================================================================

// Default proxy port. NOT 3456 — that collides with claude-code-router's default. Override via
// --port or config `models.proxyPort`.
const DEFAULT_PORT = 8473;
const SUPPORTED_PROVIDERS = ['ollama', 'openrouter'] as const;

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed CLI arguments
 */
export interface ParsedArgs {
  model?: string;
  port: number;
  apiKey?: string;
  /** Base URL for the provider (e.g. a remote/networked ollama like DEEPBLUE over tailnet) */
  baseUrl?: string;
  background: boolean;
  showHelp: boolean;
  /** Router mode: per-agent dispatch from the merged config (no single --model required). */
  router: boolean;
  errors: string[];
}

/**
 * Start proxy options
 */
export interface StartProxyOptions {
  model: string;
  port: number;
  apiKey?: string;
  /** Base URL for the provider (ollama endpoint; defaults to localhost:11434 in the handler) */
  baseUrl?: string;
  background: boolean;
  /** Test dependency injection for ModelProxy */
  _testProxy?: MockProxy;
}

/**
 * Mock proxy interface for testing
 */
interface MockProxy {
  start: () => Promise<void>;
  getPort: () => number;
  shutdown: () => Promise<void>;
  isRunning: () => boolean;
}

/**
 * Start proxy result
 */
export interface StartProxyResult {
  port: number;
  pid: number;
  model: string;
  background: boolean;
  error?: string;
  /** The proxy instance (only in foreground mode, for shutdown handling) */
  proxy?: { shutdown: () => Promise<void>; isRunning: () => boolean };
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Background start options
 */
export interface BackgroundStartOptions {
  /** Single-model mode. Omitted in router mode. */
  model?: string;
  port: number;
  apiKey?: string;
  /** Base URL for the provider (ollama endpoint) */
  baseUrl?: string;
  /** Router mode: spawn the child with --router (per-agent dispatch, no single model). */
  router?: boolean;
  /** Test dependency injection for spawn */
  _testSpawn?: typeof spawn;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

/**
 * Parse CLI arguments
 */
export function parseCliArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    model: undefined,
    port: DEFAULT_PORT,
    apiKey: undefined,
    background: false,
    showHelp: false,
    router: false,
    errors: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      result.showHelp = true;
      return result;
    }

    if (arg === '--model' && args[i + 1]) {
      result.model = args[++i];
    } else if (arg === '--port' && args[i + 1]) {
      const portStr = args[++i];
      const port = parseInt(portStr, 10);
      if (!isNaN(port) && port > 0 && port < 65536) {
        result.port = port;
      } else {
        result.errors.push(`Invalid port: ${portStr}`);
      }
    } else if (arg === '--api-key' && args[i + 1]) {
      result.apiKey = args[++i];
    } else if (arg === '--base-url' && args[i + 1]) {
      result.baseUrl = args[++i];
    } else if (arg === '--background') {
      result.background = true;
    } else if (arg === '--router') {
      result.router = true;
    }
  }

  // Validate required arguments. Router mode derives its per-agent map from the merged config,
  // so it does NOT require a single --model.
  if (!result.model && !result.showHelp && !result.router) {
    result.errors.push('--model is required');
  }

  return result;
}

// ============================================================================
// Model Validation
// ============================================================================

/**
 * Validate model format
 * Format: provider/model-name (e.g., "ollama/codellama", "openrouter/anthropic/claude-3-haiku")
 */
export function validateModel(model: string): ValidationResult {
  const slashIndex = model.indexOf('/');

  if (slashIndex <= 0) {
    return {
      valid: false,
      error: 'Invalid model format. Expected: provider/model-name',
    };
  }

  const provider = model.substring(0, slashIndex);

  if (!SUPPORTED_PROVIDERS.includes(provider as typeof SUPPORTED_PROVIDERS[number])) {
    return {
      valid: false,
      error: `Unsupported provider: ${provider}. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`,
    };
  }

  return { valid: true };
}

// ============================================================================
// Config Loading
// ============================================================================

/**
 * Get user config directory
 */
function getUserConfigDir(): string {
  return path.join(os.homedir(), '.oss');
}

/**
 * Load API key from config file based on provider
 */
export function loadApiKeyFromConfig(provider: string): string | undefined {
  const configPath = path.join(getUserConfigDir(), 'config.json');

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);

      // Map provider to config key
      const keyMap: Record<string, string> = {
        openrouter: 'openrouterApiKey',
      };

      const configKey = keyMap[provider];
      if (configKey && config[configKey]) {
        return config[configKey];
      }
    }
  } catch {
    // Return undefined on error
  }

  return undefined;
}

/**
 * Load the ollama base URL from config (`apiKeys.ollama`), if set.
 * Lets a component route to a remote/networked ollama (e.g. DEEPBLUE over tailnet)
 * instead of the localhost:11434 default. Returns undefined when not configured.
 */
export function loadOllamaBaseUrlFromConfig(): string | undefined {
  const configPath = path.join(getUserConfigDir(), 'config.json');

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      // The model-routing config nests provider keys under `models.apiKeys`; also accept the
      // legacy top-level `apiKeys` location.
      const url = config?.models?.apiKeys?.ollama ?? config?.apiKeys?.ollama;
      if (typeof url === 'string' && url.length > 0) {
        return url;
      }
    }
  } catch {
    // Return undefined on error (missing/malformed config)
  }

  return undefined;
}

// ============================================================================
// PID File Management
// ============================================================================

/**
 * Get PID file path
 * If port is specified, includes port in filename to allow multiple proxies
 */
export function getPidFilePath(port?: number): string {
  const ossDir = getUserConfigDir();
  if (port && port !== DEFAULT_PORT) {
    return path.join(ossDir, `proxy-${port}.pid`);
  }
  return path.join(ossDir, 'proxy.pid');
}

/**
 * Write PID file
 */
export function writePidFile(pid: number, port?: number): void {
  const ossDir = getUserConfigDir();
  fs.mkdirSync(ossDir, { recursive: true });
  fs.writeFileSync(getPidFilePath(port), String(pid));
}

/**
 * Clean up PID file
 */
export function cleanupPidFile(port?: number): void {
  const pidPath = getPidFilePath(port);
  try {
    if (fs.existsSync(pidPath)) {
      fs.unlinkSync(pidPath);
    }
  } catch {
    // Ignore errors during cleanup
  }
}

// ============================================================================
// Proxy Startup
// ============================================================================

/**
 * Start the proxy server
 */
export async function startProxy(options: StartProxyOptions): Promise<StartProxyResult> {
  const { model, port, apiKey, baseUrl, background, _testProxy } = options;

  // Use test proxy if provided, otherwise create real one
  const proxy = _testProxy || new ModelProxy({
    model,
    port,
    apiKey,
    baseUrl,
  });

  try {
    await proxy.start();

    const actualPort = proxy.getPort();
    const pid = process.pid;

    return {
      port: actualPort,
      pid,
      model,
      background,
      // Return proxy instance for shutdown handling (not for background mode)
      proxy: background ? undefined : proxy,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    if (err.code === 'EADDRINUSE') {
      return {
        port,
        pid: 0,
        model,
        background,
        error: `Port ${port} is already in use`,
      };
    }

    return {
      port,
      pid: 0,
      model,
      background,
      error: err.message,
    };
  }
}

// ============================================================================
// Router Mode (per-agent dispatch)
// ============================================================================

/**
 * Router-mode proxy config: the per-agent map + fallback + ollama base url, sourced from the
 * merged OSS config. Mirrors ModelProxyConfigRouter['routerConfig'].
 */
export interface RouterProxyConfig {
  models?: {
    default?: string;
    agents?: Record<string, string>;
    fallbackEnabled?: boolean;
    apiKeys?: { ollama?: string };
  };
}

/**
 * Normalize a raw parsed config object into a RouterProxyConfig. Fallback defaults ON (the
 * safety net); agents default to empty; the ollama base url is read from `models.apiKeys.ollama`
 * with a legacy fallback to top-level `apiKeys.ollama`.
 */
export function buildRouterConfig(raw: unknown): RouterProxyConfig {
  const r = (raw ?? {}) as { models?: Record<string, unknown>; apiKeys?: { ollama?: string } };
  const models = (r.models ?? {}) as {
    default?: string;
    agents?: Record<string, string>;
    fallbackEnabled?: boolean;
    apiKeys?: { ollama?: string };
  };
  return {
    models: {
      default: models.default,
      agents: models.agents ?? {},
      fallbackEnabled: models.fallbackEnabled !== false,
      apiKeys: { ollama: models.apiKeys?.ollama ?? r.apiKeys?.ollama },
    },
  };
}

/**
 * Load the router config from `~/.oss/config.json` (best-effort; defaults on any error).
 */
export function loadRouterConfigFromFile(): RouterProxyConfig {
  const configPath = path.join(getUserConfigDir(), 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return buildRouterConfig(JSON.parse(content));
    }
  } catch {
    // Fall through to defaults on any error (missing/malformed config)
  }
  return buildRouterConfig({});
}

/**
 * Router start options
 */
export interface RouterStartOptions {
  port: number;
  background: boolean;
  routerConfig: RouterProxyConfig;
  /** Test dependency injection for ModelProxy */
  _testProxy?: MockProxy;
}

/**
 * Start the proxy in router mode (per-agent dispatch). No single model is pinned; each request
 * is routed by its OSS-ROUTE-AGENT marker against `routerConfig.models.agents`.
 */
export async function startRouterProxy(options: RouterStartOptions): Promise<StartProxyResult> {
  const { port, background, routerConfig, _testProxy } = options;

  const proxy = _testProxy || new ModelProxy({ router: true, routerConfig, port });

  try {
    await proxy.start();

    return {
      port: proxy.getPort(),
      pid: process.pid,
      model: 'router',
      background,
      proxy: background ? undefined : proxy,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    if (err.code === 'EADDRINUSE') {
      return { port, pid: 0, model: 'router', background, error: `Port ${port} is already in use` };
    }

    return { port, pid: 0, model: 'router', background, error: err.message };
  }
}

/**
 * Start proxy in background mode
 */
export async function startProxyBackground(options: BackgroundStartOptions): Promise<StartProxyResult> {
  const { model, port, apiKey, baseUrl, router, _testSpawn } = options;

  // Use injected spawn or real spawn
  const spawnFn = _testSpawn || spawn;

  // Build args for the child process. Router mode pins no model — it dispatches per-agent from
  // the merged config — so it spawns with --router instead of --model.
  const args = router
    ? ['--router', '--port', String(port)]
    : ['--model', model!, '--port', String(port)];

  if (!router && apiKey) {
    args.push('--api-key', apiKey);
  }

  if (!router && baseUrl) {
    args.push('--base-url', baseUrl);
  }

  // Spawn detached child process. Use a real filesystem path — `node <file:// URL>` cannot be
  // loaded as a script, so the child would crash instantly and the proxy would never bind.
  const selfPath = fileURLToPath(import.meta.url);
  const child = spawnFn(process.execPath, [selfPath, ...args], {
    detached: true,
    stdio: 'ignore',
  });

  // Unref to allow parent to exit
  child.unref();

  const pid = child.pid || 0;

  // Write PID file
  if (pid) {
    writePidFile(pid, port);
  }

  return {
    port,
    pid,
    model: router ? 'router' : model!,
    background: true,
  };
}

// ============================================================================
// Shutdown Handling
// ============================================================================

/**
 * Create shutdown handler for graceful termination
 */
export function createShutdownHandler(
  proxy: { shutdown: () => Promise<void>; isRunning: () => boolean },
  cleanup?: () => void
): (signal: string) => Promise<void> {
  return async (signal: string) => {
    // Shutdown proxy (closes all connections)
    if (proxy.isRunning()) {
      await proxy.shutdown();
    }

    // Run additional cleanup
    if (cleanup) {
      cleanup();
    }
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Format output as JSON string
 */
export function formatOutput(result: StartProxyResult): string {
  return JSON.stringify(result);
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
start-proxy - Start ModelProxy server for agent model routing

USAGE:
  npx tsx src/cli/start-proxy.ts --model <provider/model> [options]

OPTIONS:
  --model <provider/model>  Model to use (required)
                           Examples: ollama/codellama, openrouter/anthropic/claude-3-haiku
  --port <number>          Port to listen on (default: ${DEFAULT_PORT})
  --api-key <key>          API key for the provider (loaded from config if not provided)
  --router                 Router mode: per-agent dispatch from the merged config (no --model)
  --background             Run in background (detached) mode
  --help, -h               Show this help message

EXAMPLES:
  npx tsx src/cli/start-proxy.ts --model ollama/codellama
  npx tsx src/cli/start-proxy.ts --model ollama/codellama --port 3457
  npx tsx src/cli/start-proxy.ts --model openrouter/anthropic/claude-3-haiku --api-key sk-or-xxx
  npx tsx src/cli/start-proxy.ts --model ollama/codellama --background

OUTPUT:
  JSON object with: { port, pid, model, background, error? }
`);
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parsedArgs = parseCliArgs(args);

  // Show help if requested
  if (parsedArgs.showHelp) {
    showHelp();
    process.exit(0);
  }

  // Check for errors
  if (parsedArgs.errors.length > 0) {
    console.error(JSON.stringify({ error: parsedArgs.errors.join(', ') }));
    process.exit(1);
  }

  // Router mode: per-agent dispatch from the merged config (no single model). Handled before
  // model validation since router mode pins no model.
  if (parsedArgs.router) {
    try {
      if (parsedArgs.background) {
        const result = await startProxyBackground({ router: true, port: parsedArgs.port });
        console.log(formatOutput(result));
      } else {
        const result = await startRouterProxy({
          port: parsedArgs.port,
          background: false,
          routerConfig: loadRouterConfigFromFile(),
        });

        if (result.error) {
          console.error(formatOutput(result));
          process.exit(1);
        }

        if (result.proxy) {
          const shutdownHandler = createShutdownHandler(result.proxy, () => {
            cleanupPidFile(parsedArgs.port);
          });
          process.on('SIGTERM', () => {
            shutdownHandler('SIGTERM').then(() => process.exit(0));
          });
          process.on('SIGINT', () => {
            shutdownHandler('SIGINT').then(() => process.exit(0));
          });
        }

        writePidFile(process.pid, parsedArgs.port);
        console.log(formatOutput(result));
      }
    } catch (err) {
      console.error(JSON.stringify({ error: (err as Error).message }));
      process.exit(1);
    }
    return;
  }

  // Validate model
  const validation = validateModel(parsedArgs.model!);
  if (!validation.valid) {
    console.error(JSON.stringify({ error: validation.error }));
    process.exit(1);
  }

  // Extract provider from model string
  const provider = parsedArgs.model!.split('/')[0];

  // Load API key from config if not provided
  let apiKey = parsedArgs.apiKey;
  if (!apiKey && provider !== 'ollama') {
    apiKey = loadApiKeyFromConfig(provider);
  }

  // Resolve the ollama base URL: explicit --base-url wins, else config apiKeys.ollama,
  // else undefined (handler falls back to localhost:11434).
  let baseUrl = parsedArgs.baseUrl;
  if (!baseUrl && provider === 'ollama') {
    baseUrl = loadOllamaBaseUrlFromConfig();
  }

  try {
    let result: StartProxyResult;

    if (parsedArgs.background) {
      // Start in background mode
      result = await startProxyBackground({
        model: parsedArgs.model!,
        port: parsedArgs.port,
        apiKey,
        baseUrl,
      });
    } else {
      // Start in foreground mode
      result = await startProxy({
        model: parsedArgs.model!,
        port: parsedArgs.port,
        apiKey,
        baseUrl,
        background: false,
      });

      if (result.error) {
        console.error(formatOutput(result));
        process.exit(1);
      }

      // Set up signal handlers for graceful shutdown using the ACTUAL running proxy
      if (result.proxy) {
        const shutdownHandler = createShutdownHandler(result.proxy, () => {
          cleanupPidFile(parsedArgs.port);
        });

        process.on('SIGTERM', () => {
          shutdownHandler('SIGTERM').then(() => process.exit(0));
        });

        process.on('SIGINT', () => {
          shutdownHandler('SIGINT').then(() => process.exit(0));
        });
      }

      // Write PID file
      writePidFile(process.pid, parsedArgs.port);
    }

    // Output result
    console.log(formatOutput(result));
  } catch (err) {
    console.error(JSON.stringify({ error: (err as Error).message }));
    process.exit(1);
  }
}

// Main execution - only run when called directly
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('start-proxy.js') ||
  process.argv[1]?.endsWith('start-proxy.ts');

if (isMainModule) {
  main().catch((err) => {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  });
}
