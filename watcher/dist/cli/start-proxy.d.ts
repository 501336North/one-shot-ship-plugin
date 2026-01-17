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
    background: boolean;
    showHelp: boolean;
    errors: string[];
}
/**
 * Start proxy options
 */
export interface StartProxyOptions {
    model: string;
    port: number;
    apiKey?: string;
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
    model: string;
    port: number;
    apiKey?: string;
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
export {};
//# sourceMappingURL=start-proxy.d.ts.map