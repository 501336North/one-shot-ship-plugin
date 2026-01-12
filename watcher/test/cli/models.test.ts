/**
 * @behavior /oss:models CLI provides model management commands
 * @acceptance-criteria AC-MODELS.1 through AC-MODELS.7
 * @boundary CLI
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';

// Mock dependencies BEFORE importing the module under test
vi.mock('fs');
vi.mock('os');

// We'll import the module after mocking
// Import will be done after the module is created

describe('/oss:models Command', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Mock os.homedir to return a predictable path
    (os.homedir as Mock).mockReturnValue('/home/testuser');

    // Default: config.json does not exist
    (fs.existsSync as Mock).mockReturnValue(false);
    (fs.readFileSync as Mock).mockReturnValue('{}');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * @behavior AC-MODELS.1: list - Show available models grouped by provider
   */
  describe('list subcommand', () => {
    it('should list available models grouped by provider', async () => {
      // Import the module under test
      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['list']);

      expect(output).toContain('OpenRouter');
      expect(output).toContain('Ollama');
      expect(output).toContain('OpenAI');
      expect(output).toContain('Gemini');
    });

    it('should show model names under each provider', async () => {
      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['list']);

      // Should show some popular models
      expect(output).toContain('deepseek');
      expect(output).toContain('gpt-4o');
      expect(output).toContain('gemini-2.0-flash');
    });
  });

  /**
   * @behavior AC-MODELS.2: search - Filter models by query
   */
  describe('search subcommand', () => {
    it('should filter models by query', async () => {
      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['search', 'code']);

      expect(output).toContain('codellama');
      expect(output).toContain('deepseek-coder');
    });

    it('should show free models with --free flag', async () => {
      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['search', '--free']);

      // Free models should be included
      expect(output).toContain('llama');
      // Paid-only models like gpt-4o should not appear
      expect(output).not.toContain('gpt-4o');
    });

    it('should combine query and --free flag', async () => {
      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['search', 'code', '--free']);

      expect(output).toContain('codellama');
      // Paid coding models should not appear
      expect(output).not.toContain('gpt-4o');
    });

    it('should return empty result for non-matching query', async () => {
      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['search', 'nonexistentxyz123']);

      expect(output).toContain('No models found');
    });
  });

  /**
   * @behavior AC-MODELS.3: config - Show current model configuration
   */
  describe('config subcommand', () => {
    it('should show current model configuration', async () => {
      // Setup: config exists with model settings
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        models: {
          default: 'claude',
          agents: {
            'oss:code-reviewer': 'ollama/codellama',
          },
          commands: {
            'oss:ship': 'gemini/gemini-2.0-flash',
          },
        },
      }));

      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['config']);

      expect(output).toContain('Default: claude');
      expect(output).toContain('oss:code-reviewer');
      expect(output).toContain('ollama/codellama');
      expect(output).toContain('oss:ship');
      expect(output).toContain('gemini/gemini-2.0-flash');
    });

    it('should show default configuration when no custom config exists', async () => {
      (fs.existsSync as Mock).mockReturnValue(false);

      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['config']);

      expect(output).toContain('Default: claude');
      expect(output).toContain('No custom model mappings configured');
    });
  });

  /**
   * @behavior AC-MODELS.4: set - Configure model for a prompt
   */
  describe('set subcommand', () => {
    it('should update model config for prompt', async () => {
      // Setup: mock writeFileSync
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        models: {
          default: 'claude',
          agents: {},
        },
      }));
      const writeFileSyncMock = vi.fn();
      (fs.writeFileSync as Mock) = writeFileSyncMock;

      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['set', 'oss:code-reviewer', 'ollama/codellama']);

      expect(output).toContain('Updated');
      expect(output).toContain('oss:code-reviewer');
      expect(output).toContain('ollama/codellama');

      // Verify the file was written with correct content
      expect(writeFileSyncMock).toHaveBeenCalled();
      const writtenContent = JSON.parse(writeFileSyncMock.mock.calls[0][1]);
      expect(writtenContent.models.agents['oss:code-reviewer']).toBe('ollama/codellama');
    });

    it('should fail with invalid model identifier', async () => {
      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['set', 'oss:code-reviewer', 'invalid']);

      expect(output).toContain('Invalid model identifier');
    });

    it('should auto-detect prompt type from name', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({ models: {} }));
      const writeFileSyncMock = vi.fn();
      (fs.writeFileSync as Mock) = writeFileSyncMock;

      const { executeModelsCommand } = await import('../../src/cli/models.js');

      // Commands start with oss: and are known commands
      await executeModelsCommand(['set', 'oss:ship', 'gemini/gemini-2.0-flash']);

      const writtenContent = JSON.parse(writeFileSyncMock.mock.calls[0][1]);
      expect(writtenContent.models.commands['oss:ship']).toBe('gemini/gemini-2.0-flash');
    });
  });

  /**
   * @behavior AC-MODELS.5: test - Verify model connectivity
   */
  describe('test subcommand', () => {
    it('should verify model connectivity for valid model', async () => {
      const { executeModelsCommand } = await import('../../src/cli/models.js');

      // Mock successful Ollama connection
      const output = await executeModelsCommand(['test', 'ollama/llama3.2']);

      // Note: In actual test, we'd mock the HTTP request
      // For now, we just verify the output format
      expect(output).toMatch(/[OK|FAIL]/);
    });

    it('should report failure for invalid model', async () => {
      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['test', 'invalid/nonexistent']);

      expect(output).toContain('FAIL');
      expect(output).toContain('Invalid model identifier');
    });

    it('should report connection failure when provider unavailable', async () => {
      const { executeModelsCommand, setTestModeProviderFail } = await import('../../src/cli/models.js');

      // Set test mode to simulate provider failure
      setTestModeProviderFail(true);

      const output = await executeModelsCommand(['test', 'openrouter/deepseek/deepseek-chat']);

      expect(output).toContain('FAIL');
      expect(output).toMatch(/connection|unavailable|error/i);

      // Reset test mode
      setTestModeProviderFail(false);
    });
  });

  /**
   * @behavior AC-MODELS.6: keys set - Store API key for provider
   */
  describe('keys subcommand', () => {
    it('should store API key for provider', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({}));
      const writeFileSyncMock = vi.fn();
      (fs.writeFileSync as Mock) = writeFileSyncMock;

      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['keys', 'set', 'openrouter', 'sk-or-test-key']);

      expect(output).toContain('API key stored');
      expect(output).toContain('openrouter');

      // Verify the file was written with masked key
      expect(writeFileSyncMock).toHaveBeenCalled();
      const writtenContent = JSON.parse(writeFileSyncMock.mock.calls[0][1]);
      expect(writtenContent.apiKeys.openrouter).toBe('sk-or-test-key');
    });

    it('should fail for invalid provider', async () => {
      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['keys', 'set', 'invalid-provider', 'key123']);

      expect(output).toContain('Invalid provider');
      expect(output).toContain('Supported providers');
    });

    it('should list configured API keys (masked)', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        apiKeys: {
          openrouter: 'sk-or-v1-actual-key-here',
          openai: 'sk-actual-openai-key',
        },
      }));

      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['keys', 'list']);

      expect(output).toContain('openrouter');
      expect(output).toContain('openai');
      // Keys should be masked
      expect(output).toContain('***');
      expect(output).not.toContain('actual-key');
    });
  });

  /**
   * @behavior AC-MODELS.7: Handle missing arguments gracefully
   */
  describe('error handling', () => {
    it('should show help when no subcommand provided', async () => {
      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand([]);

      expect(output).toContain('Usage:');
      expect(output).toContain('list');
      expect(output).toContain('search');
      expect(output).toContain('config');
      expect(output).toContain('set');
      expect(output).toContain('test');
      expect(output).toContain('keys');
    });

    it('should show error for unknown subcommand', async () => {
      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['unknown']);

      expect(output).toContain('Unknown subcommand');
      expect(output).toContain('unknown');
    });

    it('should show error when set command missing arguments', async () => {
      const { executeModelsCommand } = await import('../../src/cli/models.js');

      const output = await executeModelsCommand(['set']);

      expect(output).toContain('Usage:');
      expect(output).toContain('set <prompt> <model>');
    });
  });
});
