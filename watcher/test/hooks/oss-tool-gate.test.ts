/**
 * @behavior Every Bash and edit call goes through hooks/oss-tool-gate.sh. The wrapper hands the hook
 *   JSON to `node watcher/dist/cli/tool-gate.cjs pre|post` and returns the gate's answer: allow
 *   (exit 0, its stdout) or refuse (exit 2, its stderr). When the gate itself fails (any other exit,
 *   a missing CLI, no node, a killed process), the call is allowed, the agent is told
 *   "tool-gate failed, rules not checked." and one gate-error line is logged.
 * @business-rule ADR-005: a broken gate must never block an OSS session, and must never decide
 *   `permissionDecision` (that would skip the user's permission prompt).
 * @boundary hooks/oss-tool-gate.sh, run for real against a temp plugin root whose
 *   watcher/dist/cli/tool-gate.cjs is a small stub (its answer is chosen per test with STUB_EXIT).
 *
 * Hermetic: temp plugin root and project per test, HOME is the setup sandbox, CLAUDE_PROJECT_DIR is
 * unset unless a test sets it, no network.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const WRAPPER = path.join(__dirname, '../../../hooks/oss-tool-gate.sh');
const NODE_DIR = path.dirname(process.execPath);
const TELL = 'tool-gate failed, rules not checked.';
const HANG_BACKSTOP_MS = 15_000;

// Echoes what it received (mode, stdin, env) on stdout, or a refusal on stderr, then exits STUB_EXIT.
const STUB_CLI = `
const input = require('fs').readFileSync(0, 'utf8');
if (process.env.STUB_HANG) {
  require('fs').writeFileSync(process.env.STUB_HANG, String(process.pid));
  setInterval(() => {}, 1000);
  return;
}
const code = Number(process.env.STUB_EXIT || '0');
if (code === 2) process.stderr.write('Refused: stub refusal\\n');
else process.stdout.write(JSON.stringify({
  mode: process.argv[2],
  input,
  home: process.env.HOME,
  pluginRoot: process.env.CLAUDE_PLUGIN_ROOT,
  projectDir: process.env.CLAUDE_PROJECT_DIR === undefined ? null : process.env.CLAUDE_PROJECT_DIR,
}) + '\\n');
if (code === 137) process.kill(process.pid, 'SIGKILL');
process.exitCode = code;
`;

let caseRoot: string;
let pluginRoot: string;
let project: string;
let noNodeBin: string;

beforeEach(() => {
  caseRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-tool-gate-wrapper-')));
  pluginRoot = path.join(caseRoot, 'plugin');
  project = path.join(caseRoot, 'project');
  fs.mkdirSync(path.join(pluginRoot, 'watcher/dist/cli'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'watcher/dist/cli/tool-gate.cjs'), STUB_CLI);
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  // A PATH with the basic tools but no node.
  noNodeBin = path.join(caseRoot, 'bin-without-node');
  fs.mkdirSync(noNodeBin);
  for (const tool of ['date', 'mkdir']) {
    const found = ['/bin', '/usr/bin'].map((d) => path.join(d, tool)).find((p) => fs.existsSync(p));
    if (found !== undefined) fs.symlinkSync(found, path.join(noNodeBin, tool));
  }
});

/** Stub gate processes started by a test; any still alive is killed after it. */
const stubPids: number[] = [];

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitFor<T>(probe: () => T | null, ms: number): Promise<T | null> {
  const until = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value !== null || Date.now() > until) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

afterEach(() => {
  for (const pid of stubPids.splice(0)) {
    if (isAlive(pid)) process.kill(pid, 'SIGKILL');
  }
  fs.rmSync(caseRoot, { recursive: true, force: true });
});

function hookInput(event: string): string {
  return JSON.stringify({
    session_id: 's-1',
    hook_event_name: event,
    tool_name: 'Bash',
    tool_input: { command: 'echo INPUT-MARKER-7f3a' },
    cwd: project,
  });
}

interface RunOptions {
  mode: 'pre' | 'post';
  input: string;
  stubExit?: number;
  path?: string;
  projectDir?: string;
  cwd?: string;
}

function runWrapper(opts: RunOptions) {
  const env: NodeJS.ProcessEnv = {
    HOME: process.env.HOME,
    PATH: opts.path ?? `${NODE_DIR}:/usr/bin:/bin`,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    STUB_EXIT: String(opts.stubExit ?? 0),
  };
  if (opts.projectDir !== undefined) env.CLAUDE_PROJECT_DIR = opts.projectDir;
  return spawnSync('/bin/bash', [WRAPPER, opts.mode], {
    input: opts.input,
    env,
    cwd: opts.cwd ?? project,
    encoding: 'utf8',
    timeout: HANG_BACKSTOP_MS,
  });
}

function eventsLog(root: string): string {
  const file = path.join(root, '.oss/tool-gates/events.ndjson');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

describe('hooks/oss-tool-gate.sh', () => {
  it("should pass stdin through and return the CLI's exit 0 / exit 2 + stderr", () => {
    const input = hookInput('PreToolUse');

    const allowed = runWrapper({ mode: 'pre', input, stubExit: 0 });
    expect(allowed.status).toBe(0);
    const seen = JSON.parse(allowed.stdout) as Record<string, unknown>;
    expect(seen).toEqual({
      mode: 'pre',
      input,
      home: process.env.HOME,
      pluginRoot,
      projectDir: null,
    });

    const post = runWrapper({ mode: 'post', input: hookInput('PostToolUse'), stubExit: 0 });
    expect(post.status).toBe(0);
    expect((JSON.parse(post.stdout) as { mode: string }).mode).toBe('post');

    const refused = runWrapper({ mode: 'pre', input, stubExit: 2 });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('Refused: stub refusal');
    expect(refused.stdout).toBe('');

    expect(eventsLog(project)).toBe('');
  });

  it('should allow, log gate-error and tell when the CLI exits 1, is missing, or node is missing from PATH', () => {
    const failures: { name: string; mode: 'pre' | 'post'; run: () => ReturnType<typeof runWrapper> }[] = [
      { name: 'exit 1', mode: 'pre', run: () => runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), stubExit: 1 }) },
      { name: 'exit 3', mode: 'post', run: () => runWrapper({ mode: 'post', input: hookInput('PostToolUse'), stubExit: 3 }) },
      { name: 'killed', mode: 'pre', run: () => runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), stubExit: 137 }) },
      {
        name: 'missing CLI',
        mode: 'post',
        run: () => {
          fs.rmSync(path.join(pluginRoot, 'watcher/dist/cli/tool-gate.cjs'));
          return runWrapper({ mode: 'post', input: hookInput('PostToolUseFailure') });
        },
      },
      {
        name: 'node missing from PATH',
        mode: 'pre',
        run: () => runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), path: noNodeBin }),
      },
    ];

    for (const failure of failures) {
      fs.rmSync(path.join(project, '.oss'), { recursive: true, force: true });
      const result = failure.run();

      expect(result.status, failure.name).toBe(0);
      expect(JSON.parse(result.stdout), failure.name).toEqual({
        hookSpecificOutput: {
          hookEventName: failure.mode === 'pre' ? 'PreToolUse' : 'PostToolUse',
          additionalContext: TELL,
        },
      });
      expect(result.stdout, failure.name).not.toContain('permissionDecision');

      const lines = eventsLog(project).split('\n').filter((l) => l !== '');
      expect(lines, failure.name).toHaveLength(1);
      const event = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(event, failure.name).toMatchObject({ tool: 'unknown', kind: 'gate-error', result: 'allowed' });
      expect(typeof event.ts, failure.name).toBe('string');
      expect(lines[0], failure.name).not.toContain('INPUT-MARKER');
    }
  });

  it('should log gate-error under CLAUDE_PROJECT_DIR when it is set', () => {
    const elsewhere = path.join(caseRoot, 'elsewhere');
    fs.mkdirSync(elsewhere);

    const result = runWrapper({
      mode: 'pre',
      input: hookInput('PreToolUse'),
      stubExit: 1,
      projectDir: project,
      cwd: elsewhere,
    });

    expect(result.status).toBe(0);
    expect(eventsLog(project)).toContain('"gate-error"');
    expect(eventsLog(elsewhere)).toBe('');
  });

  it('should not log gate-error through a symlinked .oss folder', () => {
    const outside = path.join(caseRoot, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(project, '.oss'));

    const result = runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), stubExit: 1 });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ hookSpecificOutput: { additionalContext: TELL } });
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('should run with CLAUDE_PROJECT_DIR unset', () => {
    expect(process.env.CLAUDE_PROJECT_DIR).toBeUndefined();
    const sub = path.join(project, 'src');
    fs.mkdirSync(sub);

    const allowed = runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), cwd: sub });
    expect(allowed.status).toBe(0);
    expect((JSON.parse(allowed.stdout) as { projectDir: unknown }).projectDir).toBeNull();
    expect(allowed.stderr).not.toContain('unbound variable');

    const failed = runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), stubExit: 1, cwd: sub });
    expect(failed.status).toBe(0);
    expect(failed.stderr).not.toContain('unbound variable');
    expect(eventsLog(project)).toContain('"gate-error"');
  });
});

describe('hooks/oss-tool-gate.sh with CLAUDE_PLUGIN_ROOT unset', () => {
  const REAL_WRAPPER = path.join(__dirname, '../../../hooks/oss-tool-gate.sh');
  const REAL_BASE = path.join(__dirname, '../../../config/tool-gates.json');
  let repo: string;

  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-tool-gate-unset-root-')));
    for (const args of [
      ['init', '-q', '-b', 'main'],
      ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'initial'],
    ]) {
      spawnSync('git', args, { cwd: repo, stdio: 'ignore' });
    }
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("should still refuse a push to main when the repo holds a lax config/tool-gates.json", () => {
    // Given: the repo on main ships its own config/tool-gates.json that protects no real branch
    const base = JSON.parse(fs.readFileSync(REAL_BASE, 'utf8')) as object;
    fs.mkdirSync(path.join(repo, 'config'));
    fs.writeFileSync(path.join(repo, 'config', 'tool-gates.json'), JSON.stringify({ ...base, protectedBranches: ['nothing'] }));

    // When: the real wrapper runs from the repo with no CLAUDE_PLUGIN_ROOT
    const result = spawnSync('/bin/bash', [REAL_WRAPPER, 'pre'], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd: repo }),
      env: { HOME: process.env.HOME, PATH: `${NODE_DIR}:/usr/bin:/bin` },
      cwd: repo,
      encoding: 'utf8',
      timeout: HANG_BACKSTOP_MS,
    });

    // Then: the plugin's own rules refuse it
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('`main`');
  });

  it('should leave no gate process behind when the wrapper itself is ended with SIGTERM', async () => {
    // Given: a gate that never answers, behind the wrapper
    const pidFile = path.join(caseRoot, 'stub.pid');
    const wrapper = spawn('/bin/bash', [WRAPPER, 'pre'], {
      env: { HOME: process.env.HOME, PATH: `${NODE_DIR}:/usr/bin:/bin`, CLAUDE_PLUGIN_ROOT: pluginRoot, STUB_HANG: pidFile },
      cwd: project,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    wrapper.stdin.end(hookInput('PreToolUse'));
    const gatePid = await waitFor(() => (fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8') !== '' ? Number(fs.readFileSync(pidFile, 'utf8')) : null), 5000);
    expect(gatePid).not.toBeNull();
    stubPids.push(gatePid!);
    const exited = new Promise((resolve) => wrapper.once('exit', resolve));

    // When: Claude Code ends the wrapper (its hook timeout)
    wrapper.kill('SIGTERM');
    await exited;

    // Then: the gate process is gone too
    await waitFor(() => (isAlive(gatePid!) ? null : true), 3000);
    expect(isAlive(gatePid!)).toBe(false);
  }, HANG_BACKSTOP_MS);
});
