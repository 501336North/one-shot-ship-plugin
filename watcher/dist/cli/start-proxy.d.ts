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
import { spawn } from 'child_process';
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
    proxy?: {
        shutdown: () => Promise<void>;
        isRunning: () => boolean;
    };
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
/**
 * Parse CLI arguments
 */
export declare function parseCliArgs(args: string[]): ParsedArgs;
/**
 * Validate model format
 * Format: provider/model-name (e.g., "ollama/codellama", "openrouter/anthropic/claude-3-haiku")
 */
export declare function validateModel(model: string): ValidationResult;
/**
 * Load API key from config file based on provider
 */
export declare function loadApiKeyFromConfig(provider: string): string | undefined;
/**
 * Load the ollama base URL from config (`apiKeys.ollama`), if set.
 * Lets a component route to a remote/networked ollama (e.g. DEEPBLUE over tailnet)
 * instead of the localhost:11434 default. Returns undefined when not configured.
 */
export declare function loadOllamaBaseUrlFromConfig(): string | undefined;
/**
 * Get PID file path
 * If port is specified, includes port in filename to allow multiple proxies
 */
export declare function getPidFilePath(port?: number): string;
/**
 * Write PID file
 */
export declare function writePidFile(pid: number, port?: number): void;
/**
 * Clean up PID file
 */
export declare function cleanupPidFile(port?: number): void;
/**
 * Start the proxy server
 */
export declare function startProxy(options: StartProxyOptions): Promise<StartProxyResult>;
/**
 * Router-mode proxy config: the per-agent map + fallback + ollama base url, sourced from the
 * merged OSS config. Mirrors ModelProxyConfigRouter['routerConfig'].
 */
export interface RouterProxyConfig {
    models?: {
        default?: string;
        agents?: Record<string, string>;
        fallbackEnabled?: boolean;
        apiKeys?: {
            ollama?: string;
        };
        /** Per-model native ollama `think` flag (bare model name → boolean). Opt-in; absent ⇒ unchanged. */
        think?: Record<string, boolean>;
    };
}
/**
 * Normalize a raw parsed config object into a RouterProxyConfig. Fallback defaults ON (the
 * safety net); agents default to empty; the ollama base url is read from `models.apiKeys.ollama`
 * with a legacy fallback to top-level `apiKeys.ollama`.
 */
export declare function buildRouterConfig(raw: unknown): RouterProxyConfig;
/**
 * Load the router config from `~/.oss/config.json` (best-effort; defaults on any error).
 */
export declare function loadRouterConfigFromFile(): RouterProxyConfig;
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
export declare function startRouterProxy(options: RouterStartOptions): Promise<StartProxyResult>;
/**
 * Start proxy in background mode
 */
export declare function startProxyBackground(options: BackgroundStartOptions): Promise<StartProxyResult>;
/**
 * Create shutdown handler for graceful termination
 */
export declare function createShutdownHandler(proxy: {
    shutdown: () => Promise<void>;
    isRunning: () => boolean;
}, cleanup?: () => void): (signal: string) => Promise<void>;
/**
 * Format output as JSON string
 */
export declare function formatOutput(result: StartProxyResult): string;
export declare function main(args?: string[]): Promise<void>;
export {};
//# sourceMappingURL=start-proxy.d.ts.map