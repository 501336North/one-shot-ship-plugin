/**
 * A cloned repo cannot make a watcher writer write outside the repo through a link it committed.
 *
 * @behavior Every watcher service that persists into a PROJECT's .oss/ (queue archives, workflow
 *           log, status line, supervisor state, webhook config, PR-monitor state, agent config,
 *           spec metrics, spec diffs, watcher pid/log, workflow state, OSS_ERROR append) leaves a
 *           file the repo links to byte-identical, and creates nothing in a directory it links to.
 * @business-rule ADR-1 (oss-writer-nofollow): all project-.oss writes go through ONE guard,
 *           watcher/src/utils/safe-project-write.ts. No symlinked component, each directory owned
 *           by the user, the target absent or a regular file with link count 1; JSON via
 *           O_EXCL temp + rename, appends via O_APPEND|O_NOFOLLOW. A plain project still works.
 * @boundary Real filesystem (no fs mocks): the links are the attack.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { QueueManager } from '../../src/queue/manager.js';
import { WorkflowLogger } from '../../src/logger/workflow-logger.js';
import { StatusLineService } from '../../src/services/status-line.js';
import { WatcherSupervisor } from '../../src/supervisor/watcher-supervisor.js';
import { WebhookConfig } from '../../src/config/webhook-config.js';
import { PRMonitorState } from '../../src/agents/pr-monitor-state.js';
import { saveAgentConfig } from '../../src/agents/config.js';
import { SpecMetricsService } from '../../src/services/spec-metrics.js';
import { logDiff } from '../../src/services/spec-reconciler/diff-generator.js';
import type { CoverageDiff, SpecMetricsFile } from '../../src/services/spec-reconciler/types.js';
import { WorkflowStateService } from '../../src/services/workflow-state.js';
import { Watcher } from '../../src/index.js';
import { safeMkdirOss } from '../../src/utils/safe-project-write.js';
import type { CreateTaskInput } from '../../src/types.js';

let root: string;
let project: string;
let ossDir: string;
let outside: string;
let victim: string;
let savedHome: string | undefined;
let savedCwd: string;

/** Every path under `outside` with file contents, so any write or create shows up. */
function snapshot(): string {
  const lines: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) {
        lines.push(`D ${path.relative(outside, p)}`);
        walk(p);
      } else {
        lines.push(`F ${path.relative(outside, p)} ${fs.readFileSync(p, 'utf-8')}`);
      }
    }
  };
  walk(outside);
  return lines.join('\n');
}

function link(rel: string, target: string): void {
  const p = path.join(project, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.symlinkSync(target, p);
}

const taskInput = (): CreateTaskInput => ({
  priority: 'medium',
  source: 'test-monitor',
  anomaly_type: 'test_failure',
  prompt: 'Fix the failing test',
  suggested_agent: 'debugger',
  context: { test_file: 'foo.test.ts' },
});

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-nofollow-')));
  project = path.join(root, 'home', 'repo');
  ossDir = path.join(project, '.oss');
  outside = path.join(root, 'outside');
  victim = path.join(outside, 'victim.txt');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(outside, 'dir'), { recursive: true });
  fs.writeFileSync(victim, 'VICTIM rc file\n');
  fs.writeFileSync(path.join(outside, 'dir', 'sentinel'), 'sentinel\n');
  savedHome = process.env.HOME;
  process.env.HOME = path.join(root, 'home');
  savedCwd = process.cwd();
});

afterEach(() => {
  process.chdir(savedCwd);
  process.env.HOME = savedHome;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('project .oss writers do not follow committed links', () => {
  it('QueueManager: a linked queue.json.tmp is not written (persist)', async () => {
    link('.oss/queue.json.tmp', victim);
    const before = snapshot();
    const manager = new QueueManager(ossDir);
    await manager.initialize();
    await manager.addTask(taskInput());
    expect(snapshot()).toBe(before);
  });

  it('QueueManager: a linked queue-failed.json.tmp is not written (archive)', async () => {
    fs.mkdirSync(ossDir, { recursive: true });
    const manager = new QueueManager(ossDir);
    await manager.initialize();
    const task = await manager.addTask(taskInput());
    link('.oss/queue-failed.json.tmp', victim);
    const before = snapshot();
    await manager.moveToFailed(task.id, 'boom');
    expect(snapshot()).toBe(before);
  });

  it('QueueManager: a linked .oss directory gets no queue.json', async () => {
    fs.symlinkSync(path.join(outside, 'dir'), ossDir);
    const before = snapshot();
    const manager = new QueueManager(ossDir);
    await manager.initialize();
    await manager.addTask(taskInput());
    expect(snapshot()).toBe(before);
  });

  it('WorkflowStateService: a hard-linked workflow-state.json is not written', async () => {
    fs.mkdirSync(ossDir, { recursive: true });
    const json = path.join(outside, 'victim.json');
    fs.writeFileSync(json, '{"keep": true}\n');
    fs.linkSync(json, path.join(ossDir, 'workflow-state.json'));
    const before = snapshot();
    await new WorkflowStateService(path.join(ossDir, 'workflow-state.json')).setSupervisor('intervening');
    expect(snapshot()).toBe(before);
  });

  it('WorkflowLogger: a linked workflow.log is not appended to', async () => {
    link('.oss/workflow.log', victim);
    const before = snapshot();
    await new WorkflowLogger(ossDir).log({ cmd: 'build', event: 'START', data: {} });
    expect(snapshot()).toBe(before);
  });

  it('StatusLineService: a linked status-line.json is not written', async () => {
    link('.oss/status-line.json', victim);
    const before = snapshot();
    await new StatusLineService(ossDir).setTDDPhase('RED');
    expect(snapshot()).toBe(before);
  });

  it('WebhookConfig: a linked config.json is not written', async () => {
    link('.oss/config.json', victim);
    const before = snapshot();
    try {
      await new WebhookConfig(ossDir).enable({ port: 8080 });
    } catch {
      // a refusal may surface as an error; only the outside file matters
    }
    expect(snapshot()).toBe(before);
  });

  it('PRMonitorState: a linked pr-monitor-state.json is not written', async () => {
    link('.oss/pr-monitor-state.json', victim);
    process.chdir(project);
    const before = snapshot();
    const state = new PRMonitorState();
    state.addProcessedComment('IC_1');
    await state.save();
    expect(snapshot()).toBe(before);
  });

  it('saveAgentConfig: a linked agents.json is not written', async () => {
    link('.oss/agents.json', path.join(outside, 'agents.json'));
    fs.writeFileSync(path.join(outside, 'agents.json'), '{"agents": {}}\n');
    process.chdir(project);
    const before = snapshot();
    await saveAgentConfig('pr-monitor', { enabled: true });
    expect(snapshot()).toBe(before);
  });

  it('SpecMetricsService: a linked spec-metrics.json is not written', async () => {
    link('.oss/spec-metrics.json', victim);
    const before = snapshot();
    const metrics: SpecMetricsFile = { version: '1.0', updated_at: '2026-01-01T00:00:00.000Z', features: {} };
    await new SpecMetricsService(project).saveMetrics(metrics);
    expect(snapshot()).toBe(before);
  });

  it('logDiff: a linked spec-diffs.log is not appended to', async () => {
    link('.oss/spec-diffs.log', victim);
    const before = snapshot();
    const side = { components: { total: 1, implemented: 1, ratio: 1 }, criteria: { total: 1, implemented: 1, ratio: 1 }, behaviors: { total: 1, implemented: 1, ratio: 1 }, driftCount: 0 };
    const diff: CoverageDiff = { feature: 'f', trigger: 't', timestamp: '2026-01-01T00:00:00.000Z', before: side, after: side, resolved: [], new: [], net: { coverageChange: 0, driftChange: 0 } };
    await logDiff(diff, project);
    expect(snapshot()).toBe(before);
  });

  it('Watcher: a dangling watcher.pid link and a linked watcher.log are not written', async () => {
    link('.oss/watcher.pid', path.join(outside, 'created.pid'));
    link('.oss/watcher.log', victim);
    const before = snapshot();
    const watcher = new Watcher(ossDir, 'test-api-key');
    try {
      await watcher.start();
    } finally {
      await watcher.stop();
    }
    expect(snapshot()).toBe(before);
  });

  it('WatcherSupervisor: a linked workflow-state.json is not written', async () => {
    fs.mkdirSync(ossDir, { recursive: true });
    fs.writeFileSync(path.join(ossDir, 'settings.json'), JSON.stringify({ supervisor: { mode: 'workflow-only' }, version: 1 }));
    link('.oss/workflow-state.json', victim);
    const before = snapshot();
    const supervisor = new WatcherSupervisor(ossDir, new QueueManager(ossDir), { projectDir: project, configDir: path.join(root, 'home', '.oss') });
    try {
      await supervisor.start();
      await new Promise((r) => setTimeout(r, 100));
      const logger = new WorkflowLogger(ossDir);
      await logger.log({ cmd: 'ideate', event: 'START', data: {} });
      await logger.log({ cmd: 'ideate', event: 'MILESTONE', data: { section: 'problem' } });
      await new Promise((r) => setTimeout(r, 250));
    } finally {
      await supervisor.stop();
    }
    expect(snapshot()).toBe(before);
  });
});

describe('N2-2: a foreign-owned component is accepted only under a uid-0 root and if not g/o-writable', () => {
  it('a repo owned by another NON-root uid is refused', async () => {
    const spy = vi.spyOn(process, 'getuid').mockReturnValue(4242);
    try {
      fs.mkdirSync(ossDir);
      await new WorkflowLogger(ossDir).log({ cmd: 'build', event: 'START', data: {} });
    } finally {
      spy.mockRestore();
    }
    expect(fs.existsSync(path.join(ossDir, 'workflow.log'))).toBe(false);
  });

  it('under a uid-0 project root: a root-owned 0755 dir is accepted, the 1777 system tmp is refused', () => {
    expect(safeMkdirOss('/usr')).toBe(true);
    const sysTmp = fs.existsSync('/private/tmp') && !fs.lstatSync('/private/tmp').isSymbolicLink() ? '/private/tmp' : '/tmp';
    expect(safeMkdirOss(sysTmp)).toBe(false);
  });
});

describe('ship round 1 (G6)', () => {
  it('G6: an existing state file keeps its mode, and a new one gets the umask default (not 0600)', async () => {
    fs.mkdirSync(ossDir);
    const existing = path.join(ossDir, 'status-line.json');
    fs.writeFileSync(existing, '{}');
    fs.chmodSync(existing, 0o640);
    await new StatusLineService(ossDir).setTDDPhase('RED');
    expect(fs.statSync(existing).mode & 0o777).toBe(0o640);
    const fresh = path.join(ossDir, 'queue.json');
    const manager = new QueueManager(ossDir);
    await manager.initialize();
    const umask = process.umask();
    expect(fs.statSync(fresh).mode & 0o777).toBe(0o666 & ~umask);
  });

  it('N2-3: the kept mode drops setuid/setgid/sticky (masked to 0o777)', async () => {
    fs.mkdirSync(ossDir);
    const existing = path.join(ossDir, 'status-line.json');
    fs.writeFileSync(existing, '{}');
    fs.chmodSync(existing, 0o4750);
    await new StatusLineService(ossDir).setTDDPhase('RED');
    expect(fs.statSync(existing).mode & 0o7777).toBe(0o750);
  });

  it('N2-4: a NEW webhook config.json is 0600 (it holds the secret); an existing one keeps its mode', async () => {
    fs.mkdirSync(ossDir);
    await new WebhookConfig(ossDir).enable({ port: 8080 });
    expect(fs.statSync(path.join(ossDir, 'config.json')).mode & 0o777).toBe(0o600);
    fs.chmodSync(path.join(ossDir, 'config.json'), 0o640);
    await new WebhookConfig(ossDir).enable({ port: 8081 });
    expect(fs.statSync(path.join(ossDir, 'config.json')).mode & 0o777).toBe(0o640);
  });

  it('G6: no temp file is left behind when the write fails', async () => {
    fs.mkdirSync(ossDir);
    const target = path.join(ossDir, 'workflow-state.json');
    fs.mkdirSync(target); // a directory where the file goes: rename fails
    try {
      await new WorkflowStateService(target).setSupervisor('intervening');
    } catch {
      // the failure itself is fine; the leftover is not
    }
    expect(fs.readdirSync(ossDir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});

describe('controls: a plain project still gets its files', () => {
  it('QueueManager, WorkflowLogger, StatusLineService and WorkflowStateService still write', async () => {
    fs.mkdirSync(ossDir);
    const manager = new QueueManager(ossDir);
    await manager.initialize();
    await manager.addTask(taskInput());
    await new WorkflowLogger(ossDir).log({ cmd: 'build', event: 'START', data: {} });
    await new StatusLineService(ossDir).setTDDPhase('RED');
    await new WorkflowStateService(path.join(ossDir, 'workflow-state.json')).setSupervisor('intervening');
    expect(JSON.parse(fs.readFileSync(path.join(ossDir, 'queue.json'), 'utf-8')).tasks).toHaveLength(1);
    expect(fs.readFileSync(path.join(ossDir, 'workflow.log'), 'utf-8')).toContain('"cmd":"build"');
    expect(JSON.parse(fs.readFileSync(path.join(ossDir, 'status-line.json'), 'utf-8')).phase).toBe('RED');
    expect(JSON.parse(fs.readFileSync(path.join(ossDir, 'workflow-state.json'), 'utf-8')).supervisor).toBe('intervening');
  });

  it('a symlink ABOVE the project (e.g. /tmp -> /private/tmp) is not a refusal', async () => {
    const alias = path.join(root, 'alias');
    fs.symlinkSync(path.join(root, 'home'), alias);
    const aliasOss = path.join(alias, 'repo', '.oss');
    fs.mkdirSync(ossDir);
    await new WorkflowLogger(aliasOss).log({ cmd: 'build', event: 'START', data: {} });
    expect(fs.readFileSync(path.join(ossDir, 'workflow.log'), 'utf-8')).toContain('"cmd":"build"');
  });

  it('~/.oss (the user-owned global dir) keeps working even when it is a symlink', async () => {
    const realGlobal = path.join(root, 'dotfiles-oss');
    fs.mkdirSync(realGlobal);
    fs.symlinkSync(realGlobal, path.join(root, 'home', '.oss'));
    await new StatusLineService(path.join(root, 'home', '.oss')).setTDDPhase('GREEN');
    expect(JSON.parse(fs.readFileSync(path.join(realGlobal, 'status-line.json'), 'utf-8')).phase).toBe('GREEN');
  });
});
