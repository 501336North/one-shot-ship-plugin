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
import { ModelProxy } from '../services/model-proxy.js';
// ============================================================================
// Constants
// ============================================================================
const DEFAULT_PORT = 3456;
const SUPPORTED_PROVIDERS = ['ollama', 'openrouter'];
// ============================================================================
// CLI Argument Parsing
// ============================================================================
/**
 * Parse CLI arguments
 */
export function parseCliArgs(args) {
    const result = {
        model: undefined,
        port: DEFAULT_PORT,
        apiKey: undefined,
        background: false,
        showHelp: false,
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
        }
        else if (arg === '--port' && args[i + 1]) {
            const portStr = args[++i];
            const port = parseInt(portStr, 10);
            if (!isNaN(port) && port > 0 && port < 65536) {
                result.port = port;
            }
            else {
                result.errors.push(`Invalid port: ${portStr}`);
            }
        }
        else if (arg === '--api-key' && args[i + 1]) {
            result.apiKey = args[++i];
        }
        else if (arg === '--background') {
            result.background = true;
        }
    }
    // Validate required arguments
    if (!result.model && !result.showHelp) {
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
export function validateModel(model) {
    const slashIndex = model.indexOf('/');
    if (slashIndex <= 0) {
        return {
            valid: false,
            error: 'Invalid model format. Expected: provider/model-name',
        };
    }
    const provider = model.substring(0, slashIndex);
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
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
function getUserConfigDir() {
    return path.join(os.homedir(), '.oss');
}
/**
 * Load API key from config file based on provider
 */
export function loadApiKeyFromConfig(provider) {
    const configPath = path.join(getUserConfigDir(), 'config.json');
    try {
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(content);
            // Map provider to config key
            const keyMap = {
                openrouter: 'openrouterApiKey',
            };
            const configKey = keyMap[provider];
            if (configKey && config[configKey]) {
                return config[configKey];
            }
        }
    }
    catch {
        // Return undefined on error
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
export function getPidFilePath(port) {
    const ossDir = getUserConfigDir();
    if (port && port !== DEFAULT_PORT) {
        return path.join(ossDir, `proxy-${port}.pid`);
    }
    return path.join(ossDir, 'proxy.pid');
}
/**
 * Write PID file
 */
export function writePidFile(pid, port) {
    const ossDir = getUserConfigDir();
    fs.mkdirSync(ossDir, { recursive: true });
    fs.writeFileSync(getPidFilePath(port), String(pid));
}
/**
 * Clean up PID file
 */
export function cleanupPidFile(port) {
    const pidPath = getPidFilePath(port);
    try {
        if (fs.existsSync(pidPath)) {
            fs.unlinkSync(pidPath);
        }
    }
    catch {
        // Ignore errors during cleanup
    }
}
// ============================================================================
// Proxy Startup
// ============================================================================
/**
 * Start the proxy server
 */
export async function startProxy(options) {
    const { model, port, apiKey, background, _testProxy } = options;
    // Use test proxy if provided, otherwise create real one
    const proxy = _testProxy || new ModelProxy({
        model,
        port,
        apiKey,
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
    }
    catch (error) {
        const err = error;
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
/**
 * Start proxy in background mode
 */
export async function startProxyBackground(options) {
    const { model, port, apiKey, _testSpawn } = options;
    // Use injected spawn or real spawn
    const spawnFn = _testSpawn || spawn;
    // Build args for the child process
    const args = [
        '--model', model,
        '--port', String(port),
    ];
    if (apiKey) {
        args.push('--api-key', apiKey);
    }
    // Spawn detached child process
    const child = spawnFn(process.execPath, [import.meta.url, ...args], {
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
        model,
        background: true,
    };
}
// ============================================================================
// Shutdown Handling
// ============================================================================
/**
 * Create shutdown handler for graceful termination
 */
export function createShutdownHandler(proxy, cleanup) {
    return async (signal) => {
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
export function formatOutput(result) {
    return JSON.stringify(result);
}
/**
 * Show help message
 */
function showHelp() {
    console.log(`
start-proxy - Start ModelProxy server for agent model routing

USAGE:
  npx tsx src/cli/start-proxy.ts --model <provider/model> [options]

OPTIONS:
  --model <provider/model>  Model to use (required)
                           Examples: ollama/codellama, openrouter/anthropic/claude-3-haiku
  --port <number>          Port to listen on (default: ${DEFAULT_PORT})
  --api-key <key>          API key for the provider (loaded from config if not provided)
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
async function main() {
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
    // Validate model
    const validation = validateModel(parsedArgs.model);
    if (!validation.valid) {
        console.error(JSON.stringify({ error: validation.error }));
        process.exit(1);
    }
    // Extract provider from model string
    const provider = parsedArgs.model.split('/')[0];
    // Load API key from config if not provided
    let apiKey = parsedArgs.apiKey;
    if (!apiKey && provider !== 'ollama') {
        apiKey = loadApiKeyFromConfig(provider);
    }
    try {
        let result;
        if (parsedArgs.background) {
            // Start in background mode
            result = await startProxyBackground({
                model: parsedArgs.model,
                port: parsedArgs.port,
                apiKey,
            });
        }
        else {
            // Start in foreground mode
            result = await startProxy({
                model: parsedArgs.model,
                port: parsedArgs.port,
                apiKey,
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
    }
    catch (err) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
    }
}
// Main execution - only run when called directly
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('start-proxy.js') ||
    process.argv[1]?.endsWith('start-proxy.ts');
if (isMainModule) {
    main().catch((err) => {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
    });
}
//# sourceMappingURL=start-proxy.js.map