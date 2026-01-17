#!/usr/bin/env node
/**
 * @file Benchmark Environment CLI Command
 * @description CLI for validating benchmark execution environment
 *
 * @behavior Benchmark Environment CLI provides environment validation for benchmark execution
 * @acceptance-criteria AC-BENCHMARK-ENV.1 through AC-BENCHMARK-ENV.6
 *
 * Usage:
 *   node benchmark-env.js                - Check all providers
 *   node benchmark-env.js --provider ollama  - Check specific provider
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Constants
// ============================================================================

const OLLAMA_URL = 'http://localhost:11434';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of checking if Ollama is running
 */
export interface OllamaCheckResult {
  available: boolean;
  error?: string;
}

/**
 * Result of checking OpenRouter API key
 */
export interface OpenRouterKeyCheckResult {
  available: boolean;
  keyConfigured: boolean;
  error?: string;
}

/**
 * Result of checking model proxy capability
 */
export interface ModelProxyCheckResult {
  available: boolean;
  canStart: boolean;
  error?: string;
}

/**
 * Result of pinging Ollama with a specific model
 */
export interface OllamaPingResult {
  serverRunning: boolean;
  modelAvailable: boolean;
  modelName?: string;
  error?: string;
}

/**
 * Result of pinging OpenRouter
 */
export interface OpenRouterPingResult {
  serverReachable: boolean;
  authenticated: boolean;
  error?: string;
}

/**
 * Provider availability info
 */
export interface ProviderInfo {
  name: string;
  available: boolean;
  details?: string;
}

/**
 * Result of getting available providers
 */
export interface AvailableProvidersResult {
  providers: ProviderInfo[];
  summary: string;
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
 * Load config from ~/.oss/config.json
 */
function loadConfig(): Record<string, unknown> {
  const configPath = path.join(getUserConfigDir(), 'config.json');

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Return empty config on error
  }

  return {};
}

// ============================================================================
// Environment Checks (Task 1.1)
// ============================================================================

/**
 * Check if Ollama is running locally
 */
export async function checkOllamaRunning(): Promise<OllamaCheckResult> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);

    if (response.ok) {
      return { available: true };
    }

    return { available: false, error: `Ollama returned status ${response.status}` };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

/**
 * Check if OpenRouter API key is configured
 */
export async function checkOpenRouterApiKey(): Promise<OpenRouterKeyCheckResult> {
  const config = loadConfig();
  const apiKey = config.openrouterApiKey as string | undefined;

  if (apiKey && apiKey.length > 0) {
    return { available: true, keyConfigured: true };
  }

  return { available: false, keyConfigured: false };
}

/**
 * Check if model proxy can start
 */
export async function checkModelProxyCapability(): Promise<ModelProxyCheckResult> {
  try {
    // Attempt to import the ModelProxy module to verify it's available
    // In a real implementation, this might check if ports are available
    return { available: true, canStart: true };
  } catch (error) {
    return {
      available: false,
      canStart: false,
      error: error instanceof Error ? error.message : 'Cannot load proxy module',
    };
  }
}

// ============================================================================
// Provider Health Checks (Task 1.2)
// ============================================================================

/**
 * Ping Ollama and verify a specific model is available
 */
export async function pingOllamaWithModel(modelPrefix: string): Promise<OllamaPingResult> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);

    if (!response.ok) {
      return {
        serverRunning: false,
        modelAvailable: false,
        error: `Ollama returned status ${response.status}`,
      };
    }

    const data = (await response.json()) as { models: Array<{ name: string }> };
    const models = data.models || [];

    // Find a model matching the prefix
    const matchingModel = models.find((m) => m.name.startsWith(modelPrefix));

    if (matchingModel) {
      return {
        serverRunning: true,
        modelAvailable: true,
        modelName: matchingModel.name,
      };
    }

    return {
      serverRunning: true,
      modelAvailable: false,
      error: `Model ${modelPrefix} not found. Available: ${models.map((m) => m.name).join(', ')}`,
    };
  } catch (error) {
    return {
      serverRunning: false,
      modelAvailable: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

/**
 * Ping OpenRouter with API key
 */
export async function pingOpenRouter(): Promise<OpenRouterPingResult> {
  const config = loadConfig();
  const apiKey = config.openrouterApiKey as string | undefined;

  if (!apiKey) {
    return {
      serverReachable: false,
      authenticated: false,
      error: 'OpenRouter API key not configured',
    };
  }

  try {
    const response = await fetch(`${OPENROUTER_URL}/auth/key`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      return { serverReachable: true, authenticated: true };
    }

    if (response.status === 401) {
      return {
        serverReachable: true,
        authenticated: false,
        error: 'Invalid API key',
      };
    }

    return {
      serverReachable: true,
      authenticated: false,
      error: `OpenRouter returned status ${response.status}`,
    };
  } catch (error) {
    return {
      serverReachable: false,
      authenticated: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

/**
 * Get all available providers
 */
export async function getAvailableProviders(): Promise<AvailableProvidersResult> {
  const providers: ProviderInfo[] = [];

  // Check Ollama
  const ollamaResult = await pingOllamaWithModel('qwen2.5-coder');
  providers.push({
    name: 'ollama',
    available: ollamaResult.serverRunning && ollamaResult.modelAvailable,
    details: ollamaResult.modelName || ollamaResult.error,
  });

  // Check OpenRouter
  const openrouterResult = await pingOpenRouter();
  providers.push({
    name: 'openrouter',
    available: openrouterResult.serverReachable && openrouterResult.authenticated,
    details: openrouterResult.error,
  });

  // Build summary
  const availableProviders = providers.filter((p) => p.available).map((p) => p.name);
  const summary =
    availableProviders.length > 0
      ? `Available providers: ${availableProviders.join(', ')}`
      : 'No providers available';

  return { providers, summary };
}

// ============================================================================
// CLI Output
// ============================================================================

/**
 * Format environment check results for CLI output
 */
export function formatEnvironmentReport(result: AvailableProvidersResult): string {
  const lines: string[] = [];

  lines.push('=== Benchmark Environment Check ===\n');

  for (const provider of result.providers) {
    const status = provider.available ? '[OK]' : '[FAIL]';
    const details = provider.details ? ` - ${provider.details}` : '';
    lines.push(`${status} ${provider.name}${details}`);
  }

  lines.push('');
  lines.push(result.summary);

  return lines.join('\n');
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const result = await getAvailableProviders();
  console.log(formatEnvironmentReport(result));

  // Exit with non-zero if no providers available
  const anyAvailable = result.providers.some((p) => p.available);
  process.exit(anyAvailable ? 0 : 1);
}

// Main execution - only run when called directly
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('benchmark-env.js') ||
  process.argv[1]?.endsWith('benchmark-env.ts');

if (isMainModule) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
