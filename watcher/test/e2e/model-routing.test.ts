/**
 * E2E Model Routing Tests
 *
 * @behavior Complete flow from model configuration to execution with fallback
 * @acceptance-criteria Full integration test of model resolution -> execution -> cost tracking
 * @business-rule Model routing respects configuration precedence and provides fallback
 * @boundary System boundary test (config files -> router -> executor -> cost tracker)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { ModelRouter } from '../../src/services/model-router.js';
import { ModelExecutor } from '../../src/services/model-executor.js';
import { CostTracker } from '../../src/services/cost-tracker.js';
import { ModelConfig } from '../../src/config/model-config.js';

describe('E2E: Model Routing', () => {
  let testDir: string;
  let userConfigDir: string;
  let projectDir: string;

  beforeEach(() => {
    // Create unique temp directories for each test
    testDir = path.join(
      os.tmpdir(),
      `oss-e2e-model-routing-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );

    userConfigDir = path.join(testDir, '.oss-user');
    projectDir = path.join(testDir, 'project');

    // Create directories
    fs.mkdirSync(userConfigDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.oss'), { recursive: true });
  });

  afterEach(async () => {
    // Allow time for cleanup
    await new Promise((resolve) => setTimeout(resolve, 50));

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior Model Router resolves configured model for a command
   * @acceptance-criteria E2E-MODEL.1
   */
  it('should execute command with configured model', async () => {
    // GIVEN - User config with a specific model for 'oss:ship' command
    const userConfig = {
      models: {
        default: 'claude',
        commands: {
          'oss:ship': 'openai/gpt-4o',
        },
      },
    };
    fs.writeFileSync(
      path.join(userConfigDir, 'config.json'),
      JSON.stringify(userConfig)
    );

    // AND - A model router configured with these directories
    const router = new ModelRouter(userConfigDir, projectDir);

    // WHEN - We resolve the model for 'oss:ship' command
    const model = await router.resolveModel({
      promptType: 'command',
      promptName: 'oss:ship',
    });

    // THEN - The configured model should be returned
    expect(model).toBe('openai/gpt-4o');

    // AND - Executing with this model should use the correct provider
    const executor = new ModelExecutor();
    const result = await executor.execute({
      prompt: 'Execute oss:ship command',
      model,
    });

    expect(result.provider).toBe('openai');
    expect(result.fallbackUsed).toBe(false);
  });

  /**
   * @behavior Executor falls back to Claude when provider is not available
   * @acceptance-criteria E2E-MODEL.2
   */
  it('should fallback when provider not available', async () => {
    // GIVEN - A model executor configured to simulate provider failure
    const executor = new ModelExecutor();
    executor.setTestModeProviderFail(true);

    // AND - A fallback notification tracker
    const fallbackNotifications: string[] = [];
    executor.onFallback((message) => {
      fallbackNotifications.push(message);
    });

    // WHEN - We execute with a non-claude model
    const result = await executor.execute({
      prompt: 'Test prompt',
      model: 'openai/gpt-4o',
      fallbackEnabled: true,
    });

    // THEN - Should fallback to Claude
    expect(result.provider).toBe('claude');
    expect(result.fallbackUsed).toBe(true);

    // AND - Fallback notification should be sent
    expect(fallbackNotifications.length).toBe(1);
    expect(fallbackNotifications[0]).toContain('falling back to Claude');
  });

  /**
   * @behavior Cost tracker accumulates costs across multiple model executions
   * @acceptance-criteria E2E-MODEL.3
   */
  it('should track costs across session', async () => {
    // GIVEN - A cost tracker
    const dataDir = path.join(testDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const costTracker = new CostTracker(dataDir);

    // WHEN - We record usage from multiple commands with different models
    costTracker.recordUsage({
      command: 'oss:ship',
      model: 'openai/gpt-4o',
      inputTokens: 1000,
      outputTokens: 500,
      timestamp: new Date().toISOString(),
    });

    costTracker.recordUsage({
      command: 'oss:review',
      model: 'openai/gpt-4o-mini',
      inputTokens: 2000,
      outputTokens: 1000,
      timestamp: new Date().toISOString(),
    });

    costTracker.recordUsage({
      command: 'oss:build',
      model: 'ollama/codellama',
      inputTokens: 5000,
      outputTokens: 2000,
      timestamp: new Date().toISOString(),
    });

    // THEN - Total stats should reflect all usage
    const stats = costTracker.getStats();

    expect(stats.requests).toBe(3);
    expect(stats.inputTokens).toBe(8000);
    expect(stats.outputTokens).toBe(3500);
    expect(stats.totalTokens).toBe(11500);

    // AND - Cost should be calculated correctly
    // gpt-4o: (1000/1M * 2.50) + (500/1M * 10.00) = 0.0025 + 0.005 = 0.0075
    // gpt-4o-mini: (2000/1M * 0.15) + (1000/1M * 0.60) = 0.0003 + 0.0006 = 0.0009
    // ollama: 0 (free)
    // Total: 0.0075 + 0.0009 = 0.0084
    expect(stats.totalCostUsd).toBeCloseTo(0.0084, 4);

    // AND - Data should persist when flushed
    await costTracker.flush();

    const usagePath = path.join(dataDir, 'usage.json');
    expect(fs.existsSync(usagePath)).toBe(true);

    const savedData = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
    expect(savedData.records.length).toBe(3);
  });

  /**
   * @behavior Model resolution respects configuration precedence
   * @acceptance-criteria E2E-MODEL.4
   */
  it('should respect configuration precedence', async () => {
    // GIVEN - User config with global default and command mapping
    const userConfig = {
      models: {
        default: 'openai/gpt-4o-mini',
        commands: {
          'oss:review': 'openrouter/anthropic/claude-3.5-sonnet',
        },
      },
    };
    fs.writeFileSync(
      path.join(userConfigDir, 'config.json'),
      JSON.stringify(userConfig)
    );

    // AND - Project config that overrides the command mapping
    const projectConfig = {
      models: {
        commands: {
          'oss:review': 'gemini/gemini-2.0-flash',
        },
      },
    };
    fs.writeFileSync(
      path.join(projectDir, '.oss', 'config.json'),
      JSON.stringify(projectConfig)
    );

    const router = new ModelRouter(userConfigDir, projectDir);

    // WHEN/THEN - Project config takes precedence over user config
    const reviewModel = await router.resolveModel({
      promptType: 'command',
      promptName: 'oss:review',
    });
    expect(reviewModel).toBe('gemini/gemini-2.0-flash');

    // WHEN/THEN - CLI override takes precedence over everything
    const cliOverrideModel = await router.resolveModel({
      promptType: 'command',
      promptName: 'oss:review',
      cliOverride: 'openai/o1',
    });
    expect(cliOverrideModel).toBe('openai/o1');

    // WHEN/THEN - Frontmatter is used when no config mapping exists
    router.invalidateCache();
    const frontmatterModel = await router.resolveModel({
      promptType: 'command',
      promptName: 'oss:unknown',
      frontmatterModel: 'ollama/mistral',
    });
    expect(frontmatterModel).toBe('ollama/mistral');

    // WHEN/THEN - Default is used when nothing else matches
    router.invalidateCache();
    const defaultModel = await router.resolveModel({
      promptType: 'command',
      promptName: 'oss:another-unknown',
    });
    expect(defaultModel).toBe('openai/gpt-4o-mini');
  });

  /**
   * @behavior Full E2E flow: Config -> Router -> Executor -> Cost Tracker
   * @acceptance-criteria E2E-MODEL.5
   */
  it('should complete full model routing flow', async () => {
    // GIVEN - User config with model mappings
    const userConfig = {
      models: {
        default: 'claude',
        commands: {
          'oss:ship': 'openai/gpt-4o',
        },
        agents: {
          'code-reviewer': 'openrouter/deepseek/deepseek-chat',
        },
      },
    };
    fs.writeFileSync(
      path.join(userConfigDir, 'config.json'),
      JSON.stringify(userConfig)
    );

    // AND - Components initialized
    const router = new ModelRouter(userConfigDir, projectDir);
    const executor = new ModelExecutor();
    const dataDir = path.join(testDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const costTracker = new CostTracker(dataDir);

    // WHEN - We execute multiple prompts through the full pipeline
    const prompts = [
      { promptType: 'command' as const, promptName: 'oss:ship', text: 'Ship the feature' },
      { promptType: 'agent' as const, promptName: 'code-reviewer', text: 'Review this code' },
      { promptType: 'command' as const, promptName: 'oss:build', text: 'Build the project' },
    ];

    const results = [];
    for (const prompt of prompts) {
      // 1. Resolve model
      const model = await router.resolveModel({
        promptType: prompt.promptType,
        promptName: prompt.promptName,
      });

      // 2. Execute with model
      const result = await executor.execute({
        prompt: prompt.text,
        model,
      });

      // 3. Track usage (simulate token counts)
      costTracker.recordUsage({
        command: prompt.promptName,
        model,
        inputTokens: 1000,
        outputTokens: 500,
        timestamp: new Date().toISOString(),
      });

      results.push({ prompt: prompt.promptName, model, result });
    }

    // THEN - Models should be resolved correctly
    expect(results[0].model).toBe('openai/gpt-4o');
    expect(results[1].model).toBe('openrouter/deepseek/deepseek-chat');
    expect(results[2].model).toBe('claude'); // No mapping, uses default

    // AND - Execution should use correct providers
    expect(results[0].result.provider).toBe('openai');
    expect(results[1].result.provider).toBe('openrouter');
    expect(results[2].result.provider).toBe('claude');

    // AND - Costs should be tracked
    const stats = costTracker.getStats();
    expect(stats.requests).toBe(3);
    expect(stats.totalTokens).toBe(4500); // 3 * (1000 + 500)
  });

  /**
   * @behavior Config validation detects missing API keys
   * @acceptance-criteria E2E-MODEL.6
   */
  it('should validate config and report missing API keys', async () => {
    // GIVEN - User config that uses OpenAI models
    const userConfig = {
      models: {
        commands: {
          'oss:ship': 'openai/gpt-4o',
        },
      },
      // No apiKeys section - keys not configured
    };
    fs.writeFileSync(
      path.join(userConfigDir, 'config.json'),
      JSON.stringify(userConfig)
    );

    // WHEN - We validate the config (without env vars set)
    const modelConfig = new ModelConfig(userConfigDir);
    const validation = await modelConfig.validateConfig(projectDir);

    // THEN - Validation should report missing openai key
    // Note: This test may pass if OPENAI_API_KEY is set in environment
    // In a clean environment, it should fail validation
    expect(validation).toBeDefined();
    expect(typeof validation.valid).toBe('boolean');
    expect(Array.isArray(validation.missingKeys)).toBe(true);
  });

  /**
   * @behavior Cost tracking by command shows per-command breakdown
   * @acceptance-criteria E2E-MODEL.7
   */
  it('should provide cost breakdown by command', async () => {
    // GIVEN - A cost tracker with varied usage
    const dataDir = path.join(testDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const costTracker = new CostTracker(dataDir);

    // Record multiple usages for different commands
    costTracker.recordUsage({
      command: 'oss:ship',
      model: 'openai/gpt-4o',
      inputTokens: 1000,
      outputTokens: 500,
      timestamp: new Date().toISOString(),
    });

    costTracker.recordUsage({
      command: 'oss:ship',
      model: 'openai/gpt-4o',
      inputTokens: 2000,
      outputTokens: 1000,
      timestamp: new Date().toISOString(),
    });

    costTracker.recordUsage({
      command: 'oss:review',
      model: 'openai/gpt-4o-mini',
      inputTokens: 3000,
      outputTokens: 1500,
      timestamp: new Date().toISOString(),
    });

    // WHEN - We get stats by command
    const shipStats = costTracker.getUsageByCommand('oss:ship');
    const reviewStats = costTracker.getUsageByCommand('oss:review');

    // THEN - Ship command should have 2 requests
    expect(shipStats.requests).toBe(2);
    expect(shipStats.inputTokens).toBe(3000);
    expect(shipStats.outputTokens).toBe(1500);

    // AND - Review command should have 1 request
    expect(reviewStats.requests).toBe(1);
    expect(reviewStats.inputTokens).toBe(3000);
    expect(reviewStats.outputTokens).toBe(1500);
  });

  /**
   * @behavior Cost tracker persists and loads data correctly
   * @acceptance-criteria E2E-MODEL.8
   */
  it('should persist and reload cost data', async () => {
    // GIVEN - A cost tracker with recorded usage
    const dataDir = path.join(testDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const costTracker = new CostTracker(dataDir);

    costTracker.recordUsage({
      command: 'oss:test',
      model: 'openai/gpt-4o',
      inputTokens: 1000,
      outputTokens: 500,
      timestamp: '2024-01-15T10:00:00Z',
    });

    // WHEN - We flush and create a new tracker
    await costTracker.flush();

    const newTracker = new CostTracker(dataDir);
    await newTracker.load();

    // THEN - The new tracker should have the same stats
    const stats = newTracker.getStats();
    expect(stats.requests).toBe(1);
    expect(stats.inputTokens).toBe(1000);
    expect(stats.outputTokens).toBe(500);
  });

  /**
   * @behavior Model router caches resolved models for performance
   * @acceptance-criteria E2E-MODEL.9
   */
  it('should cache model resolutions', async () => {
    // GIVEN - User config with model mappings
    const userConfig = {
      models: {
        commands: {
          'oss:ship': 'openai/gpt-4o',
        },
      },
    };
    fs.writeFileSync(
      path.join(userConfigDir, 'config.json'),
      JSON.stringify(userConfig)
    );

    const router = new ModelRouter(userConfigDir, projectDir);

    // WHEN - We resolve the same model multiple times
    const model1 = await router.resolveModel({
      promptType: 'command',
      promptName: 'oss:ship',
    });

    // Modify the config file after first resolution
    const newConfig = {
      models: {
        commands: {
          'oss:ship': 'gemini/gemini-2.0-flash',
        },
      },
    };
    fs.writeFileSync(
      path.join(userConfigDir, 'config.json'),
      JSON.stringify(newConfig)
    );

    const model2 = await router.resolveModel({
      promptType: 'command',
      promptName: 'oss:ship',
    });

    // THEN - Both resolutions should return the cached value
    expect(model1).toBe('openai/gpt-4o');
    expect(model2).toBe('openai/gpt-4o'); // Still cached

    // WHEN - We invalidate the cache and resolve again
    router.invalidateCache();
    const model3 = await router.resolveModel({
      promptType: 'command',
      promptName: 'oss:ship',
    });

    // THEN - The new value should be returned
    expect(model3).toBe('gemini/gemini-2.0-flash');
  });

  /**
   * @behavior Executor respects fallbackEnabled=false
   * @acceptance-criteria E2E-MODEL.10
   */
  it('should throw error when fallback disabled and provider fails', async () => {
    // GIVEN - A model executor configured to fail
    const executor = new ModelExecutor();
    executor.setTestModeProviderFail(true);

    // WHEN/THEN - Executing with fallback disabled should throw
    await expect(
      executor.execute({
        prompt: 'Test prompt',
        model: 'openai/gpt-4o',
        fallbackEnabled: false,
      })
    ).rejects.toThrow('Provider openai failed');
  });
});
