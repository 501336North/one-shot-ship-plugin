/**
 * @file BenchmarkRunner Provider Routing Tests
 * @behavior BenchmarkRunner routes tasks to appropriate integrations via ProviderFactory
 * @acceptance-criteria AC-ROUTING.1 through AC-ROUTING.3
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BenchmarkRunner } from '../../../src/services/benchmark/runner.js';
import { ProviderFactory } from '../../../src/services/benchmark/provider-factory.js';
import type { BenchmarkTask, BenchmarkResult } from '../../../src/services/benchmark/types.js';
import type { ProviderConfig } from '../../../src/services/benchmark/runner.js';
import type { ProviderIntegration } from '../../../src/services/benchmark/provider-factory.js';

// Mock fetch globally to prevent actual network calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock fs module for file system operations
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('{}'),
}));

describe('BenchmarkRunner provider routing', () => {
  let testTask: BenchmarkTask;
  let mockProviderFactory: ProviderFactory;
  let mockClaudeIntegration: ProviderIntegration;
  let mockOllamaIntegration: ProviderIntegration;
  let mockOpenRouterIntegration: ProviderIntegration;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create test task
    testTask = {
      id: 'test-task-01',
      name: 'Test Task',
      category: 'code-review',
      prompt: 'Review this code for issues',
      expectedBehavior: ['identify issues'],
    };

    // Create mock integration results
    const createMockResult = (provider: string, model: string): BenchmarkResult => ({
      taskId: testTask.id,
      provider,
      model,
      output: `Response from ${provider}`,
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 500,
      timestamp: new Date().toISOString(),
    });

    // Create mock integrations with executeTask methods
    mockClaudeIntegration = {
      executeTask: vi.fn().mockResolvedValue(createMockResult('claude', 'claude-3-sonnet-20240229')),
    };

    mockOllamaIntegration = {
      executeTask: vi.fn().mockResolvedValue(createMockResult('ollama', 'qwen2.5-coder:7b')),
    };

    mockOpenRouterIntegration = {
      executeTask: vi.fn().mockResolvedValue(createMockResult('openrouter', 'anthropic/claude-3-haiku')),
    };

    // Create mock provider factory
    mockProviderFactory = {
      create: vi.fn((config: ProviderConfig) => {
        switch (config.name) {
          case 'claude':
            return mockClaudeIntegration;
          case 'ollama':
            return mockOllamaIntegration;
          case 'openrouter':
            return mockOpenRouterIntegration;
          default:
            throw new Error(`Unknown provider: ${config.name}`);
        }
      }),
    } as unknown as ProviderFactory;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @behavior BenchmarkRunner routes claude tasks to ClaudeIntegration via factory
   * @acceptance-criteria AC-ROUTING.1
   */
  it('should route claude tasks to ClaudeIntegration', async () => {
    // GIVEN a runner with a provider factory and claude provider
    const claudeProvider: ProviderConfig = {
      name: 'claude',
      model: 'claude-3-sonnet-20240229',
      apiKey: 'test-api-key',
      isBaseline: true,
    };

    const runner = new BenchmarkRunner({
      providers: [claudeProvider],
      tasks: [testTask],
      providerFactory: mockProviderFactory,
    });

    // WHEN running a task
    const result = await runner.runTask(testTask, claudeProvider);

    // THEN the factory should create a ClaudeIntegration
    expect(mockProviderFactory.create).toHaveBeenCalledWith(claudeProvider);
    // AND the integration's executeTask should be called
    expect(mockClaudeIntegration.executeTask).toHaveBeenCalledWith(testTask);
    // AND the result should be from Claude
    expect(result.provider).toBe('claude');
    expect(result.output).toContain('claude');
  });

  /**
   * @behavior BenchmarkRunner routes ollama tasks to OllamaIntegration via factory
   * @acceptance-criteria AC-ROUTING.2
   */
  it('should route ollama tasks to OllamaIntegration', async () => {
    // GIVEN a runner with a provider factory and ollama provider
    const ollamaProvider: ProviderConfig = {
      name: 'ollama',
      model: 'qwen2.5-coder:7b',
      baseUrl: 'http://localhost:11434',
    };

    const runner = new BenchmarkRunner({
      providers: [ollamaProvider],
      tasks: [testTask],
      providerFactory: mockProviderFactory,
    });

    // WHEN running a task
    const result = await runner.runTask(testTask, ollamaProvider);

    // THEN the factory should create an OllamaIntegration
    expect(mockProviderFactory.create).toHaveBeenCalledWith(ollamaProvider);
    // AND the integration's executeTask should be called
    expect(mockOllamaIntegration.executeTask).toHaveBeenCalledWith(testTask);
    // AND the result should be from Ollama
    expect(result.provider).toBe('ollama');
    expect(result.output).toContain('ollama');
  });

  /**
   * @behavior BenchmarkRunner routes openrouter tasks to OpenRouterIntegration via factory
   * @acceptance-criteria AC-ROUTING.3
   */
  it('should route openrouter tasks to OpenRouterIntegration', async () => {
    // GIVEN a runner with a provider factory and openrouter provider
    const openrouterProvider: ProviderConfig = {
      name: 'openrouter',
      model: 'anthropic/claude-3-haiku',
      apiKey: 'openrouter-api-key',
    };

    const runner = new BenchmarkRunner({
      providers: [openrouterProvider],
      tasks: [testTask],
      providerFactory: mockProviderFactory,
    });

    // WHEN running a task
    const result = await runner.runTask(testTask, openrouterProvider);

    // THEN the factory should create an OpenRouterIntegration
    expect(mockProviderFactory.create).toHaveBeenCalledWith(openrouterProvider);
    // AND the integration's executeTask should be called
    expect(mockOpenRouterIntegration.executeTask).toHaveBeenCalledWith(testTask);
    // AND the result should be from OpenRouter
    expect(result.provider).toBe('openrouter');
    expect(result.output).toContain('openrouter');
  });

  /**
   * @behavior BenchmarkRunner falls back to direct HTTP when no factory is provided
   * @acceptance-criteria AC-ROUTING.4 (backward compatibility)
   */
  it('should fall back to direct HTTP when no factory is provided', async () => {
    // GIVEN a runner without a provider factory (backward compatibility)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: 'Direct HTTP response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    });

    const provider: ProviderConfig = {
      name: 'ollama',
      model: 'qwen2.5-coder:7b',
      baseUrl: 'http://localhost:3456',
    };

    const runner = new BenchmarkRunner({
      providers: [provider],
      tasks: [testTask],
      // Note: no providerFactory
    });

    // WHEN running a task
    const result = await runner.runTask(testTask, provider);

    // THEN fetch should be called directly (not through integration)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3456/v1/messages',
      expect.objectContaining({
        method: 'POST',
      })
    );
    // AND the factory should not be called
    expect(mockProviderFactory.create).not.toHaveBeenCalled();
    // AND the result should contain the direct response
    expect(result.output).toBe('Direct HTTP response');
  });
});
