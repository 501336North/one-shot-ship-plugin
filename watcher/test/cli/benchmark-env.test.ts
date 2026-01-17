/**
 * @file Benchmark Environment CLI Tests
 * @behavior CLI provides environment validation for benchmark execution
 * @acceptance-criteria AC-BENCHMARK-ENV.1 through AC-BENCHMARK-ENV.6
 * @boundary CLI
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';

// Mock dependencies BEFORE importing the module under test
vi.mock('fs');
vi.mock('os');

describe('Benchmark environment checks', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Mock os.homedir
    (os.homedir as Mock).mockReturnValue('/home/testuser');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * @behavior CLI detects if Ollama is running locally
   * @acceptance-criteria AC-BENCHMARK-ENV.1.1
   */
  it('should detect if Ollama is running locally', async () => {
    const { checkOllamaRunning } = await import('../../src/cli/benchmark-env.js');

    // Mock fetch to simulate Ollama running
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ models: [{ name: 'qwen2.5-coder:7b' }] }),
    });

    const result = await checkOllamaRunning();

    expect(result.available).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:11434/api/tags');
  });

  /**
   * @behavior CLI detects if OpenRouter API key is configured
   * @acceptance-criteria AC-BENCHMARK-ENV.1.2
   */
  it('should detect if OpenRouter API key is configured', async () => {
    const { checkOpenRouterApiKey } = await import('../../src/cli/benchmark-env.js');

    // Mock config file with OpenRouter API key
    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.readFileSync as Mock).mockReturnValue(
      JSON.stringify({ openrouterApiKey: 'sk-or-v1-test123' })
    );

    const result = await checkOpenRouterApiKey();

    expect(result.available).toBe(true);
    expect(result.keyConfigured).toBe(true);
  });

  /**
   * @behavior CLI detects if model proxy can start
   * @acceptance-criteria AC-BENCHMARK-ENV.1.3
   */
  it('should detect if model proxy can start', async () => {
    const { checkModelProxyCapability } = await import('../../src/cli/benchmark-env.js');

    // Mock that the proxy module can be loaded
    const result = await checkModelProxyCapability();

    expect(result.available).toBe(true);
    expect(result.canStart).toBe(true);
  });
});

describe('Provider health checks', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Mock os.homedir
    (os.homedir as Mock).mockReturnValue('/home/testuser');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * @behavior CLI pings Ollama and verifies qwen2.5-coder model is available
   * @acceptance-criteria AC-BENCHMARK-ENV.2.1
   */
  it('should ping Ollama and verify qwen2.5-coder model is available', async () => {
    const { pingOllamaWithModel } = await import('../../src/cli/benchmark-env.js');

    // Mock fetch to simulate Ollama with model
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          models: [{ name: 'qwen2.5-coder:7b' }, { name: 'llama2:latest' }],
        }),
    });

    const result = await pingOllamaWithModel('qwen2.5-coder');

    expect(result.serverRunning).toBe(true);
    expect(result.modelAvailable).toBe(true);
    expect(result.modelName).toBe('qwen2.5-coder:7b');
  });

  /**
   * @behavior CLI pings OpenRouter with API key
   * @acceptance-criteria AC-BENCHMARK-ENV.2.2
   */
  it('should ping OpenRouter with API key', async () => {
    const { pingOpenRouter } = await import('../../src/cli/benchmark-env.js');

    // Mock config file with OpenRouter API key
    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.readFileSync as Mock).mockReturnValue(
      JSON.stringify({ openrouterApiKey: 'sk-or-v1-test123' })
    );

    // Mock fetch to simulate OpenRouter responding
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { credits_remaining: 10.0 } }),
    });

    const result = await pingOpenRouter();

    expect(result.serverReachable).toBe(true);
    expect(result.authenticated).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('openrouter.ai'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-or-v1-test123',
        }),
      })
    );
  });

  /**
   * @behavior CLI reports which providers are available
   * @acceptance-criteria AC-BENCHMARK-ENV.2.3
   */
  it('should report which providers are available', async () => {
    const { getAvailableProviders } = await import('../../src/cli/benchmark-env.js');

    // Mock Ollama running with model
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: 'qwen2.5-coder:7b' }] }),
      })
      // Mock OpenRouter ping
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { credits_remaining: 10.0 } }),
      });

    // Mock config with OpenRouter key
    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.readFileSync as Mock).mockReturnValue(
      JSON.stringify({ openrouterApiKey: 'sk-or-v1-test123' })
    );

    const result = await getAvailableProviders();

    expect(result.providers).toContainEqual(
      expect.objectContaining({ name: 'ollama', available: true })
    );
    expect(result.providers).toContainEqual(
      expect.objectContaining({ name: 'openrouter', available: true })
    );
    expect(result.summary).toContain('ollama');
    expect(result.summary).toContain('openrouter');
  });
});
