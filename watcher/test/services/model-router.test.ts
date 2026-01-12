/**
 * ModelRouter Tests
 *
 * @behavior Model router resolves models following precedence chain
 * @acceptance-criteria AC-ROUTER.1 through AC-ROUTER.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ModelRouter, ResolveModelParams } from '../../src/services/model-router.js';
import { ModelConfig } from '../../src/config/model-config.js';

describe('ModelRouter', () => {
  // Track directories for cleanup
  const dirsToClean: string[] = [];

  function createTestDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-router-test-'));
    dirsToClean.push(dir);
    return dir;
  }

  afterEach(() => {
    // Clean up all test directories
    for (const dir of dirsToClean) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    dirsToClean.length = 0;
    vi.restoreAllMocks();
  });

  describe('resolveModel', () => {
    it('should resolve model with CLI override taking precedence', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      // Setup project config with different model
      const ossDir = path.join(projectDir, '.oss');
      fs.mkdirSync(ossDir, { recursive: true });
      fs.writeFileSync(
        path.join(ossDir, 'config.json'),
        JSON.stringify({
          models: {
            commands: {
              'oss:ship': 'ollama/llama3.2',
            },
          },
        })
      );

      const router = new ModelRouter(userDir, projectDir);

      const model = await router.resolveModel({
        promptType: 'command',
        promptName: 'oss:ship',
        cliOverride: 'gemini/gemini-2.0-flash',
      });

      // CLI override should take precedence
      expect(model).toBe('gemini/gemini-2.0-flash');
    });

    it('should fall back through config precedence chain', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      // Setup user config
      fs.writeFileSync(
        path.join(userDir, 'config.json'),
        JSON.stringify({
          models: {
            commands: {
              'oss:ship': 'openrouter/deepseek/deepseek-chat',
            },
          },
        })
      );

      // Setup project config (should take precedence)
      const ossDir = path.join(projectDir, '.oss');
      fs.mkdirSync(ossDir, { recursive: true });
      fs.writeFileSync(
        path.join(ossDir, 'config.json'),
        JSON.stringify({
          models: {
            commands: {
              'oss:ship': 'ollama/llama3.2',
            },
          },
        })
      );

      const router = new ModelRouter(userDir, projectDir);

      const model = await router.resolveModel({
        promptType: 'command',
        promptName: 'oss:ship',
      });

      // Project config takes precedence over user config
      expect(model).toBe('ollama/llama3.2');
    });

    it('should use user config when no project config exists', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      // Setup user config only
      fs.writeFileSync(
        path.join(userDir, 'config.json'),
        JSON.stringify({
          models: {
            agents: {
              'oss:code-reviewer': 'openai/gpt-4o',
            },
          },
        })
      );

      const router = new ModelRouter(userDir, projectDir);

      const model = await router.resolveModel({
        promptType: 'agent',
        promptName: 'oss:code-reviewer',
      });

      expect(model).toBe('openai/gpt-4o');
    });

    it('should return default when no config found', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      // No configs at all
      const router = new ModelRouter(userDir, projectDir);

      const model = await router.resolveModel({
        promptType: 'agent',
        promptName: 'oss:unknown-agent',
      });

      expect(model).toBe('claude');
    });

    it('should check frontmatter when no config matches', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      // No config matches, but we provide frontmatter
      const router = new ModelRouter(userDir, projectDir);

      const model = await router.resolveModel({
        promptType: 'agent',
        promptName: 'oss:code-reviewer',
        frontmatterModel: 'openai/gpt-4o',
      });

      expect(model).toBe('openai/gpt-4o');
    });

    it('should prefer config over frontmatter', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      // Setup user config
      fs.writeFileSync(
        path.join(userDir, 'config.json'),
        JSON.stringify({
          models: {
            agents: {
              'oss:code-reviewer': 'ollama/codellama',
            },
          },
        })
      );

      const router = new ModelRouter(userDir, projectDir);

      // Even with frontmatter, config should take precedence
      const model = await router.resolveModel({
        promptType: 'agent',
        promptName: 'oss:code-reviewer',
        frontmatterModel: 'openai/gpt-4o',
      });

      expect(model).toBe('ollama/codellama');
    });

    it('should resolve models for skills', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      fs.writeFileSync(
        path.join(userDir, 'config.json'),
        JSON.stringify({
          models: {
            skills: {
              'oss:red': 'gemini/gemini-2.0-flash',
            },
          },
        })
      );

      const router = new ModelRouter(userDir, projectDir);

      const model = await router.resolveModel({
        promptType: 'skill',
        promptName: 'oss:red',
      });

      expect(model).toBe('gemini/gemini-2.0-flash');
    });

    it('should resolve models for hooks', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      fs.writeFileSync(
        path.join(userDir, 'config.json'),
        JSON.stringify({
          models: {
            hooks: {
              'pre-commit': 'ollama/codellama',
            },
          },
        })
      );

      const router = new ModelRouter(userDir, projectDir);

      const model = await router.resolveModel({
        promptType: 'hook',
        promptName: 'pre-commit',
      });

      expect(model).toBe('ollama/codellama');
    });
  });

  describe('caching', () => {
    it('should cache resolved models for performance', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      fs.writeFileSync(
        path.join(userDir, 'config.json'),
        JSON.stringify({
          models: {
            commands: {
              'oss:ship': 'ollama/llama3.2',
            },
          },
        })
      );

      const router = new ModelRouter(userDir, projectDir);

      // First call
      const model1 = await router.resolveModel({
        promptType: 'command',
        promptName: 'oss:ship',
      });

      // Modify file (but cache should still return old value)
      fs.writeFileSync(
        path.join(userDir, 'config.json'),
        JSON.stringify({
          models: {
            commands: {
              'oss:ship': 'openai/gpt-4o',
            },
          },
        })
      );

      // Second call should return cached value
      const model2 = await router.resolveModel({
        promptType: 'command',
        promptName: 'oss:ship',
      });

      expect(model1).toBe('ollama/llama3.2');
      expect(model2).toBe('ollama/llama3.2'); // Same as first call due to cache
    });

    it('should invalidate cache when invalidateCache is called', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      fs.writeFileSync(
        path.join(userDir, 'config.json'),
        JSON.stringify({
          models: {
            commands: {
              'oss:ship': 'ollama/llama3.2',
            },
          },
        })
      );

      const router = new ModelRouter(userDir, projectDir);

      // First call
      const model1 = await router.resolveModel({
        promptType: 'command',
        promptName: 'oss:ship',
      });

      // Modify file
      fs.writeFileSync(
        path.join(userDir, 'config.json'),
        JSON.stringify({
          models: {
            commands: {
              'oss:ship': 'openai/gpt-4o',
            },
          },
        })
      );

      // Invalidate cache
      router.invalidateCache();

      // Third call should read new value
      const model3 = await router.resolveModel({
        promptType: 'command',
        promptName: 'oss:ship',
      });

      expect(model1).toBe('ollama/llama3.2');
      expect(model3).toBe('openai/gpt-4o'); // New value after cache invalidation
    });
  });

  describe('edge cases', () => {
    it('should handle empty prompt name', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      const router = new ModelRouter(userDir, projectDir);

      const model = await router.resolveModel({
        promptType: 'command',
        promptName: '',
      });

      expect(model).toBe('claude');
    });

    it('should handle unknown prompt type', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      const router = new ModelRouter(userDir, projectDir);

      const model = await router.resolveModel({
        promptType: 'unknown' as 'command',
        promptName: 'test',
      });

      expect(model).toBe('claude');
    });

    it('should use global default when configured', async () => {
      const userDir = createTestDir();
      const projectDir = createTestDir();

      fs.writeFileSync(
        path.join(userDir, 'config.json'),
        JSON.stringify({
          models: {
            default: 'ollama/llama3.2',
          },
        })
      );

      const router = new ModelRouter(userDir, projectDir);

      const model = await router.resolveModel({
        promptType: 'command',
        promptName: 'oss:unknown',
      });

      expect(model).toBe('ollama/llama3.2');
    });
  });
});
