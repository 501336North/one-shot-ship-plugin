/**
 * @behavior agent-model-check CLI checks if custom model is configured for an agent
 * @acceptance-criteria AC-AMC.1 through AC-AMC.5
 * @boundary CLI
 *
 * Usage:
 *   node agent-model-check.js --agent oss:code-reviewer
 *   node agent-model-check.js --agent oss:code-reviewer --task "Review this code"
 *
 * Output (JSON):
 *   { "useProxy": false } - Use native Claude
 *   { "useProxy": true, "model": "ollama/codellama", "provider": "ollama", "proxyUrl": "http://localhost:3456" }
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock dependencies BEFORE importing the module under test
vi.mock('fs');
vi.mock('os');

describe('agent-model-check CLI', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    originalCwd = process.cwd();

    // Mock os.homedir to return a predictable path
    (os.homedir as Mock).mockReturnValue('/home/testuser');

    // Default: config.json does not exist
    (fs.existsSync as Mock).mockReturnValue(false);
    (fs.readFileSync as Mock).mockReturnValue('{}');
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  /**
   * @behavior AC-AMC.1: Return useProxy: false when no custom model configured
   */
  describe('default behavior (no model configured)', () => {
    it('should return useProxy: false when no config exists', async () => {
      (fs.existsSync as Mock).mockReturnValue(false);

      const { checkAgentModel } = await import('../../src/cli/agent-model-check.js');

      const result = await checkAgentModel({
        agentName: 'oss:code-reviewer',
        projectDir: '/test/project',
      });

      expect(result).toEqual({ useProxy: false });
    });

    it('should return useProxy: false when agent not in config', async () => {
      (fs.existsSync as Mock).mockImplementation((p: string) => {
        return p.includes('config.json');
      });
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        models: {
          agents: {
            'oss:other-agent': 'ollama/llama3.2',
          },
        },
      }));

      const { checkAgentModel } = await import('../../src/cli/agent-model-check.js');

      const result = await checkAgentModel({
        agentName: 'oss:code-reviewer',
        projectDir: '/test/project',
      });

      expect(result).toEqual({ useProxy: false });
    });

    it('should return useProxy: false when model is "claude" or "default"', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        models: {
          agents: {
            'oss:code-reviewer': 'claude',
          },
        },
      }));

      const { checkAgentModel } = await import('../../src/cli/agent-model-check.js');

      const result = await checkAgentModel({
        agentName: 'oss:code-reviewer',
        projectDir: '/test/project',
      });

      expect(result).toEqual({ useProxy: false });
    });
  });

  /**
   * @behavior AC-AMC.2: Return useProxy: true with model info when custom model configured
   */
  describe('custom model configured', () => {
    it('should return useProxy: true with ollama model info', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        models: {
          agents: {
            'oss:code-reviewer': 'ollama/codellama',
          },
        },
      }));

      const { checkAgentModel } = await import('../../src/cli/agent-model-check.js');

      const result = await checkAgentModel({
        agentName: 'oss:code-reviewer',
        projectDir: '/test/project',
      });

      expect(result).toEqual({
        useProxy: true,
        model: 'ollama/codellama',
        provider: 'ollama',
        proxyUrl: 'http://localhost:3456',
      });
    });

    it('should return useProxy: true with openrouter model info', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        models: {
          agents: {
            'oss:code-reviewer': 'openrouter/deepseek/deepseek-chat',
          },
        },
      }));

      const { checkAgentModel } = await import('../../src/cli/agent-model-check.js');

      const result = await checkAgentModel({
        agentName: 'oss:code-reviewer',
        projectDir: '/test/project',
      });

      expect(result).toEqual({
        useProxy: true,
        model: 'openrouter/deepseek/deepseek-chat',
        provider: 'openrouter',
        proxyUrl: 'http://localhost:3456',
      });
    });

    it('should return useProxy: true with gemini model info', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        models: {
          agents: {
            'oss:code-reviewer': 'gemini/gemini-2.0-flash',
          },
        },
      }));

      const { checkAgentModel } = await import('../../src/cli/agent-model-check.js');

      const result = await checkAgentModel({
        agentName: 'oss:code-reviewer',
        projectDir: '/test/project',
      });

      expect(result).toEqual({
        useProxy: true,
        model: 'gemini/gemini-2.0-flash',
        provider: 'gemini',
        proxyUrl: 'http://localhost:3456',
      });
    });
  });

  /**
   * @behavior AC-AMC.3: Respect config precedence (Project > User)
   */
  describe('config precedence', () => {
    it('should prefer project config over user config', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation((p: string) => {
        if (p.includes('.oss/config.json') && !p.includes('/home/')) {
          // Project config
          return JSON.stringify({
            models: {
              agents: {
                'oss:code-reviewer': 'ollama/codellama',
              },
            },
          });
        }
        // User config
        return JSON.stringify({
          models: {
            agents: {
              'oss:code-reviewer': 'openrouter/deepseek/deepseek-chat',
            },
          },
        });
      });

      const { checkAgentModel } = await import('../../src/cli/agent-model-check.js');

      const result = await checkAgentModel({
        agentName: 'oss:code-reviewer',
        projectDir: '/test/project',
      });

      // Project config (ollama/codellama) should take precedence
      expect(result.model).toBe('ollama/codellama');
    });
  });

  /**
   * @behavior AC-AMC.4: Handle global default model setting
   */
  describe('global default model', () => {
    it('should use global default when no specific agent mapping', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        models: {
          default: 'ollama/llama3.2',
          agents: {},
        },
      }));

      const { checkAgentModel } = await import('../../src/cli/agent-model-check.js');

      const result = await checkAgentModel({
        agentName: 'oss:code-reviewer',
        projectDir: '/test/project',
      });

      expect(result).toEqual({
        useProxy: true,
        model: 'ollama/llama3.2',
        provider: 'ollama',
        proxyUrl: 'http://localhost:3456',
      });
    });

    it('should use native Claude when global default is "claude"', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        models: {
          default: 'claude',
          agents: {},
        },
      }));

      const { checkAgentModel } = await import('../../src/cli/agent-model-check.js');

      const result = await checkAgentModel({
        agentName: 'oss:code-reviewer',
        projectDir: '/test/project',
      });

      expect(result).toEqual({ useProxy: false });
    });
  });

  /**
   * @behavior AC-AMC.5: Error handling
   */
  describe('error handling', () => {
    it('should require agent name', async () => {
      const { checkAgentModel } = await import('../../src/cli/agent-model-check.js');

      await expect(checkAgentModel({
        agentName: '',
        projectDir: '/test/project',
      })).rejects.toThrow('--agent is required');
    });

    it('should handle malformed config gracefully', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue('not valid json');

      const { checkAgentModel } = await import('../../src/cli/agent-model-check.js');

      // Should not throw, just return default behavior
      const result = await checkAgentModel({
        agentName: 'oss:code-reviewer',
        projectDir: '/test/project',
      });

      expect(result).toEqual({ useProxy: false });
    });
  });

  /**
   * @behavior AC-AMC.6: CLI argument parsing
   */
  describe('CLI argument parsing', () => {
    it('should parse --agent argument', async () => {
      const { parseCliArgs } = await import('../../src/cli/agent-model-check.js');

      const args = parseCliArgs(['--agent', 'oss:code-reviewer']);

      expect(args.agentName).toBe('oss:code-reviewer');
    });

    it('should parse --task argument', async () => {
      const { parseCliArgs } = await import('../../src/cli/agent-model-check.js');

      const args = parseCliArgs(['--agent', 'oss:code-reviewer', '--task', 'Review this code']);

      expect(args.agentName).toBe('oss:code-reviewer');
      expect(args.task).toBe('Review this code');
    });

    it('should parse --project argument', async () => {
      const { parseCliArgs } = await import('../../src/cli/agent-model-check.js');

      const args = parseCliArgs(['--agent', 'oss:code-reviewer', '--project', '/custom/path']);

      expect(args.agentName).toBe('oss:code-reviewer');
      expect(args.projectDir).toBe('/custom/path');
    });
  });

  /**
   * @behavior AC-AMC.7: JSON output format
   */
  describe('JSON output format', () => {
    it('should output valid JSON to stdout', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify({
        models: {
          agents: {
            'oss:code-reviewer': 'ollama/codellama',
          },
        },
      }));

      const { formatOutput } = await import('../../src/cli/agent-model-check.js');
      const { checkAgentModel } = await import('../../src/cli/agent-model-check.js');

      const result = await checkAgentModel({
        agentName: 'oss:code-reviewer',
        projectDir: '/test/project',
      });
      const output = formatOutput(result);

      // Should be valid JSON
      const parsed = JSON.parse(output);
      expect(parsed).toEqual(result);
    });
  });
});
