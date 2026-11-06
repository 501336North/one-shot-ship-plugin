/**
 * Every watcher read of a file a user or a repo can write is hang-safe (Task 70e)
 *
 * @behavior Each caller below reads its file through the shared hang-safe reader (utils/regular-file), so a FIFO
 *           (or, for the log tail, a folder) where its file should be is handled exactly like a missing file: the
 *           caller gives the same result it gives with no file, and never hangs.
 * @business-rule The watcher runs on customers' Macs. A FIFO at ~/.oss/config.json, in a project's .oss, at a
 *           log or at a prompt file in tmp blocked the reading process forever. Each case runs in a child process
 *           under a hard time limit, once with the file missing and once with a FIFO there; the outputs must match.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { runInChild, TEST_LIMIT_MS } from '../helpers/child-run.js';

let work: string;
beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-user-file-reads-'));
});
afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

// Every case's code starts with this: H is the sandbox HOME (the project is H/proj, the cwd); out() prints a
// result with H and timestamps masked, so the missing run and the FIFO run compare equal.
const PRELUDE = `
  const H = process.env.HOME;
  const out = (x) => console.log(JSON.stringify(x ?? null).split(H).join('<home>')
    .replace(/\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z/g, '<time>'));
`;

interface Case {
  /** the file, relative to HOME */
  at: string;
  /** what stands at `at` in place of the file (default a FIFO) */
  kind?: 'fifo' | 'folder';
  /** other files the case needs, relative to HOME */
  files?: Record<string, string>;
  /** run with an fs that counts each look at `at` (stat, lstat, existsSync) in globalThis.touched (T80) */
  countLooks?: boolean;
  code: string;
}

// The fs for a countLooks case: AT_PATH is the case's file.
const LOOK_SHIM = `
  import * as real from 'node:fs';
  export * from 'node:fs';
  globalThis.touched = 0;
  const look = (p) => { if (p === process.env.AT_PATH) globalThis.touched++; };
  export function existsSync(p) { look(p); return real.existsSync(p); }
  export function statSync(p, ...a) { look(p); return real.statSync(p, ...a); }
  export function lstatSync(p, ...a) { look(p); return real.lstatSync(p, ...a); }
  export default { ...real, existsSync, statSync, lstatSync };
`;

const GROUPS: Record<string, Record<string, Case>> = {
  '~/.oss/config.json': {
    'Watcher.loadConfig': {
      at: '.oss/config.json',
      code: `import { Watcher } from './index.js'; out(await new Watcher(H + '/.oss', 'k').loadConfig());`,
    },
    'WebhookConfig (load on start)': {
      at: '.oss/config.json',
      code: `import { WebhookConfig } from './config/webhook-config.js';
        const w = new WebhookConfig(H + '/.oss'); out([w.isConfigured(), w.getPort()]);`,
    },
    'ModelConfig.loadUserConfig': {
      at: '.oss/config.json',
      code: `import { ModelConfig } from './config/model-config.js'; out(await new ModelConfig(H + '/.oss').loadUserConfig());`,
    },
    'benchmark-env': {
      at: '.oss/config.json',
      code: `import { checkOpenRouterApiKey } from './cli/benchmark-env.js'; out(await checkOpenRouterApiKey());`,
    },
    'start-proxy loadApiKeyFromConfig': {
      at: '.oss/config.json',
      code: `import { loadApiKeyFromConfig } from './cli/start-proxy.js'; out(loadApiKeyFromConfig('openrouter'));`,
    },
    'start-proxy loadOllamaBaseUrlFromConfig': {
      at: '.oss/config.json',
      code: `import { loadOllamaBaseUrlFromConfig } from './cli/start-proxy.js'; out(loadOllamaBaseUrlFromConfig());`,
    },
    'start-proxy loadRouterConfigFromFile': {
      at: '.oss/config.json',
      code: `import { loadRouterConfigFromFile } from './cli/start-proxy.js'; out(loadRouterConfigFromFile());`,
    },
    'agent-model-check': {
      at: '.oss/config.json',
      code: `import { checkAgentModel } from './cli/agent-model-check.js';
        out(await checkAgentModel({ agentName: 'oss:none', projectDir: H + '/proj' }));`,
    },
    'oss-launch loadMergedConfig': {
      at: '.oss/config.json',
      code: `import * as fs from 'fs'; import * as path from 'path'; import * as os from 'os';
        import { loadMergedConfig } from './cli/oss-launch.js'; out(loadMergedConfig(fs, path, os));`,
    },
    'models config': {
      at: '.oss/config.json',
      code: `import { executeModelsCommand } from './cli/models.js'; out(await executeModelsCommand(['config']));`,
    },
    'readApiCredentials': {
      at: '.oss/config.json',
      code: `import { readApiCredentials } from './api/api-credentials.js'; out(readApiCredentials(H + '/.oss'));`,
    },
    'StartupOptimizer.checkAuth': {
      at: '.oss/config.json',
      code: `import { StartupOptimizer } from './services/startup-optimizer.js';
        const r = await new StartupOptimizer().checkAuth(); out([r.authenticated, r.fromCache]);`,
    },
    'OnboardingService.validateSetup': {
      at: '.oss/config.json',
      code: `import { OnboardingService } from './services/onboarding.js';
        out(await new OnboardingService({ configDir: H + '/.oss' }).validateSetup());`,
    },
  },
  "a project's .oss": {
    'ModelConfig.loadProjectConfig': {
      at: 'proj/.oss/config.json',
      code: `import { ModelConfig } from './config/model-config.js';
        out(await new ModelConfig(H + '/.oss').loadProjectConfig(H + '/proj'));`,
    },
    'agents loadProjectConfig': {
      at: 'proj/.oss/agents.json',
      code: `import { loadProjectConfig } from './agents/config.js'; out(await loadProjectConfig());`,
    },
    'PRMonitorState.load': {
      at: 'proj/.oss/pr-monitor-state.json',
      code: `import { PRMonitorState } from './agents/pr-monitor-state.js';
        const s = new PRMonitorState(); await s.load(); out([s.getStats(), s.getLastPollTime()]);`,
    },
    'SpecMetricsService.loadMetrics': {
      at: 'proj/.oss/spec-metrics.json',
      code: `import { SpecMetricsService } from './services/spec-metrics.js';
        out(await new SpecMetricsService(H + '/proj').loadMetrics());`,
    },
    'SpecMonitor.getFeatureMetrics': {
      at: 'proj/.oss/dev/active/f/DESIGN.md',
      code: `import { SpecMonitor } from './monitors/spec-monitor.js';
        out(await new SpecMonitor({}, { basePath: H + '/proj' }).getFeatureMetrics('f'));`,
    },
    'BuildPreflightService.runPreflightCheck': {
      at: 'proj/.oss/dev/active/f/DESIGN.md',
      code: `import { SpecMonitor } from './monitors/spec-monitor.js';
        import { BuildPreflightService } from './services/build-preflight.js';
        const m = new SpecMonitor({}, { basePath: H + '/proj' });
        const r = await new BuildPreflightService(m, {}, H + '/proj').runPreflightCheck('f'); out([r.status, r.coverage]);`,
    },
    'autoFixCheckbox': {
      at: 'proj/.oss/dev/active/f/DESIGN.md',
      code: `import { autoFixCheckbox } from './services/spec-reconciler/auto-fixer.js';
        out((await autoFixCheckbox(H + '/proj/.oss/dev/active/f/DESIGN.md', 'C-1')).success);`,
    },
    'checkArchive (PROGRESS.md)': {
      at: 'proj/.oss/dev/active/f/PROGRESS.md',
      code: `import { checkArchive } from './healthchecks/archive.js';
        out(await checkArchive({ devActivePath: H + '/proj/.oss/dev/active' }));`,
    },
  },
  'watcher state in ~/.oss': {
    'Watcher.isAnotherWatcherRunning': {
      at: '.oss/watcher.pid',
      code: `import { Watcher } from './index.js'; out(await new Watcher(H + '/.oss', 'k').isAnotherWatcherRunning());`,
    },
    'QueueManager.initialize': {
      at: '.oss/queue.json',
      code: `import { QueueManager } from './queue/manager.js';
        const q = new QueueManager(H + '/.oss'); await q.initialize(); out(await q.getTasks());`,
    },
    'QueueManager archive (queue-failed.json)': {
      at: '.oss/queue-failed.json',
      code: `import { QueueManager } from './queue/manager.js';
        const q = new QueueManager(H + '/.oss'); await q.initialize();
        const t = await q.addTask({ priority: 'medium', source: 'test-monitor', anomaly_type: 'test_failure',
          prompt: 'p', suggested_agent: 'debugger', context: {} });
        await q.moveToFailed(t.id, 'boom'); out((await q.getTasks()).length);`,
    },
    'workflow-config credentials.enc': {
      at: '.oss/credentials.enc',
      files: { '.oss/config.json': '{"apiKey":"k","apiUrl":"https://api.example.invalid"}' },
      code: `import { getCachedOrFetch } from './api/workflow-config.js';
        globalThis.fetch = async () => new Response(JSON.stringify({ encrypted: 'x', iv: 'y', authTag: 'z' }));
        out(await getCachedOrFetch('build'));`,
    },
    'MetricsCollector.load': {
      at: '.oss/metrics.json',
      code: `import { MetricsCollector } from './services/metrics-collector.js';
        const m = new MetricsCollector(); m.load(); out(m.getTopCommands(5));`,
    },
    'EventTrackingService.load': {
      at: '.oss/events.json',
      code: `import { EventTrackingService } from './services/event-tracking.js';
        const e = new EventTrackingService(); e.load(); out(e.getRecentEvents(5));`,
    },
    'IronLawMonitor (state on start)': {
      at: '.oss/iron-law-state.json',
      code: `import { IronLawMonitor } from './services/iron-law-monitor.js';
        out(new IronLawMonitor({ projectDir: H + '/proj', stateFile: H + '/.oss/iron-law-state.json' }).getState());`,
    },
    'TutorialService.loadProgress': {
      at: '.oss/tutorial-progress.json',
      code: `import { TutorialService } from './services/tutorial.js';
        const t = new TutorialService(); t.loadProgress(); out(t.getCompletedLessons());`,
    },
    'WorkflowStateService.getState': {
      at: '.oss/workflow-state.json',
      code: `import { WorkflowStateService } from './services/workflow-state.js';
        out(await new WorkflowStateService(H + '/.oss/workflow-state.json').getState());`,
    },
    'CostTracker.load': {
      at: '.oss/usage.json',
      code: `import { CostTracker } from './services/cost-tracker.js';
        const c = new CostTracker(H + '/.oss'); await c.load(); out(c.getStats());`,
    },
    'StatusLineService.initialize': {
      at: '.oss/status-line.json',
      code: `import { StatusLineService } from './services/status-line.js';
        const s = new StatusLineService(H + '/.oss'); await s.initialize(); out(await s.getState());`,
    },
    'PromptCache.getCachedPrompt': {
      at: '.oss/cache/prompts/agents/x.json',
      code: `import { PromptCache } from './services/prompt-cache.js'; out(new PromptCache().getCachedPrompt('agents', 'x'));`,
    },
    'WatcherSupervisor (state on start)': {
      at: '.oss/workflow-state.json',
      code: `import { WatcherSupervisor } from './supervisor/watcher-supervisor.js';
        import { QueueManager } from './queue/manager.js';
        const s = new WatcherSupervisor(H + '/.oss', new QueueManager(H + '/.oss'),
          { projectDir: H + '/proj', configDir: H + '/.oss' });
        await s['loadState'](); out(s.getState());`,
    },
    'agents loadGlobalConfig': {
      at: '.oss/agents.json',
      code: `import { loadGlobalConfig } from './agents/config.js'; out(await loadGlobalConfig());`,
    },
    'SettingsService.migrateFromAudioConfig': {
      at: '.oss/audio-config',
      code: `import { SettingsService } from './services/settings.js';
        const s = new SettingsService(H + '/.oss'); s.migrateFromAudioConfig(); out(s.getSettings());`,
    },
  },
  'logs': {
    'LogReader.readAll': {
      at: '.oss/workflow.log',
      code: `import { LogReader } from './logger/log-reader.js'; out(await new LogReader(H + '/.oss').readAll());`,
    },
    'LogReader tail (a folder appears)': {
      at: '.oss/workflow.log',
      kind: 'folder',
      countLooks: true,
      // waits until the tail has looked at the path at least twice after the folder appeared (T80): no fixed
      // sleep, so a busy machine cannot end the case before a poll has seen the folder
      code: `import { LogReader } from './logger/log-reader.js';
        const r = new LogReader(H + '/.oss'); const seen = [];
        r.startTailing((e) => seen.push(e));
        if (process.env.MAKE_AT) (await import('fs')).mkdirSync(process.env.MAKE_AT);
        const from = globalThis.touched;
        while (globalThis.touched < from + 4) await new Promise((ok) => setTimeout(ok, 5));
        r.stopTailing(); out(seen);`,
    },
    'checkNotifications': {
      at: '.oss/workflow.log',
      code: `import { checkNotifications } from './healthchecks/notifications.js';
        const r = await checkNotifications({ logPath: H + '/.oss/workflow.log', projectDir: H + '/proj' });
        out([r.status, r.message]);`,
    },
    'checkDelegation': {
      at: '.oss/session.log',
      code: `import { checkDelegation } from './healthchecks/delegation.js';
        const r = await checkDelegation({ sessionLogPath: H + '/.oss/session.log' }); out([r.status, r.message]);`,
    },
    'checkQualityGates': {
      at: '.oss/session.log',
      code: `import { checkQualityGates } from './healthchecks/quality-gates.js';
        const r = await checkQualityGates({ sessionLogPath: H + '/.oss/session.log' }); out([r.status, r.message]);`,
    },
    'checkLogging': {
      at: '.oss/session.log',
      code: `import { checkLogging } from './healthchecks/logging.js';
        const r = await checkLogging({ sessionLogPath: H + '/.oss/session.log' }); out([r.status, r.message]);`,
    },
  },
  'a prompt file in tmp': {
    'runAgentOffload (prompt file)': {
      at: 'prompt.md',
      code: `import { runAgentOffload } from './cli/agent-offload.js';
        const r = await runAgentOffload({ agent: 'oss:x', promptFile: H + '/prompt.md', projectDir: H + '/proj' }, {
          checkAgentModel: async () => ({ useProxy: true, model: 'ollama/x', proxyUrl: 'http://127.0.0.1:9' }),
          isProxyReachable: async () => true,
          spawnFn: () => { throw new Error('spawned'); },
        });
        out([r.offloaded, r.reason]);`,
    },
  },
};

/** Run a case with its file missing, or with a FIFO (or folder) at it; returns the child's output. */
function runCase(c: Case, place: boolean): string {
  const home = fs.mkdtempSync(path.join(work, 'h-'));
  for (const d of ['.oss/cache/prompts/agents', 'proj/.oss/dev/active/f']) {
    fs.mkdirSync(path.join(home, d), { recursive: true });
  }
  for (const [rel, text] of Object.entries(c.files ?? {})) fs.writeFileSync(path.join(home, rel), text);
  const at = path.join(home, c.at);
  const env: Record<string, string> = {};
  if (place && c.kind === 'folder') {
    env.MAKE_AT = at; // made by the case after it starts, as a file appearing later would be
  } else if (place) {
    execFileSync('mkfifo', [at]);
  }
  let fsShim: string | undefined;
  if (c.countLooks) {
    fsShim = path.join(home, 'fs-shim.mjs');
    fs.writeFileSync(fsShim, LOOK_SHIM);
    env.AT_PATH = at;
  }
  const run = runInChild(PRELUDE + c.code, { home, cwd: path.join(home, 'proj'), env, fsShim });
  expect(run.hung, `${place ? 'with the FIFO' : 'missing'}: the read hung`).toBe(false);
  expect(run.status, `${place ? 'with the FIFO' : 'missing'}: ${run.stderr}`).toBe(0);
  return run.stdout;
}

describe('watcher reads of user-writable files treat a FIFO as missing (Task 70e)', () => {
  for (const [group, cases] of Object.entries(GROUPS)) {
    describe(group, () => {
      it.each(Object.entries(cases))('%s', (_name, c) => {
        const missing = runCase(c, false);

        expect(runCase(c, true)).toBe(missing);
      }, TEST_LIMIT_MS);
    });
  }
});
