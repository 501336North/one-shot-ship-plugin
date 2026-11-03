/**
 * Agent Configuration Tests
 *
 * @behavior Agent configuration loading with global/project override semantics
 * @acceptance-criteria Configs merge correctly with project taking precedence
 * @business-rule Projects can override global agent defaults
 * @boundary Configuration file I/O
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadGlobalConfig,
  loadProjectConfig,
  mergeConfigs,
  getAgentConfig,
  type AgentsConfig,
} from '../../src/agents/config';
import { DEFAULT_AGENT_CONFIG } from '../../src/agents/types';

// Real files in a sandbox (T70e): HOME (for ~/.oss/agents.json) and the project (the cwd, for .oss/agents.json)
let sandbox: string;
let originalHome: string | undefined;
let originalCwd: string;

/** Write an agents.json: 'global' is ~/.oss/agents.json, 'project' is <cwd>/.oss/agents.json. */
function writeAgents(where: 'global' | 'project', config: AgentsConfig): void {
  const dir = path.join(sandbox, where === 'global' ? 'home' : 'project', '.oss');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agents.json'), JSON.stringify(config));
}

describe('Agent Configuration', () => {
  beforeEach(() => {
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-agents-config-')));
    fs.mkdirSync(path.join(sandbox, 'home'));
    fs.mkdirSync(path.join(sandbox, 'project'));
    originalHome = process.env.HOME;
    originalCwd = process.cwd();
    process.env.HOME = path.join(sandbox, 'home');
    process.chdir(path.join(sandbox, 'project'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
    fs.rmSync(sandbox, { recursive: true, force: true });
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

      writeAgents('global', mockConfig);

      // WHEN - We load global config
      const result = await loadGlobalConfig();

      // THEN - Config should be loaded and parsed
      expect(result.agents['pr-monitor'].enabled).toBe(true);
      expect(result.agents['pr-monitor'].interval).toBe(300000);
    });

    it('should return empty agents when config file is missing', async () => {
      // GIVEN - No global config file (the sandbox HOME has none)

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

      writeAgents('project', mockConfig);

      // WHEN - We load project config
      const result = await loadProjectConfig();

      // THEN - Config should be loaded and parsed
      expect(result.agents['pr-monitor'].enabled).toBe(false);
      expect(result.agents['pr-monitor'].interval).toBe(60000);
    });

    it('should return empty agents when config file is missing', async () => {
      // GIVEN - No project config file (the sandbox project has none)

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

      writeAgents('global', globalConfig);
      writeAgents('project', projectConfig);

      // WHEN - We get agent config
      const result = await getAgentConfig('pr-monitor');

      // THEN - Should return merged config
      expect(result.enabled).toBe(false);
      expect(result.interval).toBe(60000);
    });

    it('should return defaults when config files are missing', async () => {
      // GIVEN - No config files (neither the sandbox HOME nor the project has one)

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
