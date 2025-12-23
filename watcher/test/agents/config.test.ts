/**
 * Agent Configuration Tests
 *
 * @behavior Agent configuration loading with global/project override semantics
 * @acceptance-criteria Configs merge correctly with project taking precedence
 * @business-rule Projects can override global agent defaults
 * @boundary Configuration file I/O
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  loadGlobalConfig,
  loadProjectConfig,
  mergeConfigs,
  getAgentConfig,
  type AgentsConfig,
} from '../../src/agents/config';
import { DEFAULT_AGENT_CONFIG } from '../../src/agents/types';

// Mock fs for testing
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
      access: vi.fn(),
    },
  };
});

describe('Agent Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('AgentsConfig Type', () => {
    it('should define AgentsConfig type for global/project config', () => {
      // GIVEN - An AgentsConfig object
      const config: AgentsConfig = {
        agents: {
          'pr-monitor': {
            enabled: true,
            interval: 300000,
            maxRetries: 3,
            retryOnFailure: true,
          },
          watcher: {
            enabled: true,
            interval: 30000,
            maxRetries: 1,
            retryOnFailure: false,
          },
        },
      };

      // THEN - Config should support agents map
      expect(config.agents).toBeDefined();
      expect(config.agents['pr-monitor']).toBeDefined();
      expect(config.agents['watcher']).toBeDefined();
    });
  });

  describe('loadGlobalConfig', () => {
    it('should load global config from ~/.oss/agents.json', async () => {
      // GIVEN - A global config file exists
      const mockConfig: AgentsConfig = {
        agents: {
          'pr-monitor': {
            enabled: true,
            interval: 300000,
            maxRetries: 3,
            retryOnFailure: true,
          },
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));
      vi.mocked(fs.access).mockResolvedValue(undefined);

      // WHEN - We load global config
      const result = await loadGlobalConfig();

      // THEN - Config should be loaded and parsed
      expect(result.agents['pr-monitor'].enabled).toBe(true);
      expect(result.agents['pr-monitor'].interval).toBe(300000);
    });

    it('should return empty agents when config file is missing', async () => {
      // GIVEN - No global config file
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      // WHEN - We load global config
      const result = await loadGlobalConfig();

      // THEN - Should return empty agents object
      expect(result.agents).toEqual({});
    });
  });

  describe('loadProjectConfig', () => {
    it('should load project config from .oss/agents.json', async () => {
      // GIVEN - A project config file exists
      const mockConfig: AgentsConfig = {
        agents: {
          'pr-monitor': {
            enabled: false,
            interval: 60000,
            maxRetries: 1,
            retryOnFailure: false,
          },
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));
      vi.mocked(fs.access).mockResolvedValue(undefined);

      // WHEN - We load project config
      const result = await loadProjectConfig();

      // THEN - Config should be loaded and parsed
      expect(result.agents['pr-monitor'].enabled).toBe(false);
      expect(result.agents['pr-monitor'].interval).toBe(60000);
    });

    it('should return empty agents when config file is missing', async () => {
      // GIVEN - No project config file
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      // WHEN - We load project config
      const result = await loadProjectConfig();

      // THEN - Should return empty agents object
      expect(result.agents).toEqual({});
    });
  });

  describe('mergeConfigs', () => {
    it('should merge configs with project taking precedence', () => {
      // GIVEN - Global and project configs
      const globalConfig: AgentsConfig = {
        agents: {
          'pr-monitor': {
            enabled: true,
            interval: 300000,
            maxRetries: 3,
            retryOnFailure: true,
          },
          watcher: {
            enabled: true,
            interval: 30000,
            maxRetries: 1,
            retryOnFailure: true,
          },
        },
      };

      const projectConfig: AgentsConfig = {
        agents: {
          'pr-monitor': {
            enabled: false, // Override
            interval: 60000, // Override
            maxRetries: 3,
            retryOnFailure: true,
          },
        },
      };

      // WHEN - We merge configs
      const result = mergeConfigs(globalConfig, projectConfig);

      // THEN - Project values should override global
      expect(result.agents['pr-monitor'].enabled).toBe(false);
      expect(result.agents['pr-monitor'].interval).toBe(60000);
      // Watcher should remain from global
      expect(result.agents['watcher'].enabled).toBe(true);
    });
  });

  describe('getAgentConfig', () => {
    it('should return merged config for an agent', async () => {
      // GIVEN - Global and project configs exist
      const globalConfig: AgentsConfig = {
        agents: {
          'pr-monitor': {
            enabled: true,
            interval: 300000,
            maxRetries: 3,
            retryOnFailure: true,
          },
        },
      };

      const projectConfig: AgentsConfig = {
        agents: {
          'pr-monitor': {
            enabled: false,
            interval: 60000,
            maxRetries: 1,
            retryOnFailure: false,
          },
        },
      };

      // Mock to return different configs based on path
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('.oss/agents.json') && !pathStr.includes('~')) {
          return JSON.stringify(projectConfig);
        }
        return JSON.stringify(globalConfig);
      });

      // WHEN - We get agent config
      const result = await getAgentConfig('pr-monitor');

      // THEN - Should return merged config
      expect(result.enabled).toBe(false);
      expect(result.interval).toBe(60000);
    });

    it('should return defaults when config files are missing', async () => {
      // GIVEN - No config files
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      // WHEN - We get agent config
      const result = await getAgentConfig('pr-monitor');

      // THEN - Should return defaults
      expect(result.enabled).toBe(DEFAULT_AGENT_CONFIG.enabled);
      expect(result.interval).toBe(DEFAULT_AGENT_CONFIG.interval);
      expect(result.maxRetries).toBe(DEFAULT_AGENT_CONFIG.maxRetries);
      expect(result.retryOnFailure).toBe(DEFAULT_AGENT_CONFIG.retryOnFailure);
    });
  });
});
