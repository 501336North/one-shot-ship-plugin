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
 * The wrapper runs node from the absolute path in ~/.oss/node-path (written at SessionStart, checked:
 * a user- or root-owned executable, not in or linked into a temp folder), and cat and mktemp from
 * /bin and /usr/bin, never through PATH: a fake node, cat or mktemp first on PATH is never run (security
 * C1). No usable ~/.oss/node-path is a gate failure (allowed, told, logged).
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
const REAL_NODE = fs.realpathSync(process.execPath);
const NODE_PATH_FILE = path.join(process.env.HOME ?? '', '.oss', 'node-path');
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
if (process.env.STUB_WHERE) {
  // round 15, CR I2: name the file this CLI's answer goes to (found by its inode under ~/.oss)
  const fs = require('fs'), path = require('path');
  const out = fs.fstatSync(1);
  const found = [];
  const walk = (dir) => { for (const name of (fs.existsSync(dir) ? fs.readdirSync(dir) : [])) { const p = path.join(dir, name); const st = fs.lstatSync(p); if (st.isDirectory()) walk(p); else if (st.ino === out.ino && st.dev === out.dev) found.push(p); } };
  walk(path.join(process.env.HOME, '.oss'));
  process.stdout.write(JSON.stringify(found));
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
  fs.mkdirSync(path.dirname(NODE_PATH_FILE), { recursive: true });
  fs.writeFileSync(NODE_PATH_FILE, `${REAL_NODE}\n`, { mode: 0o600 });
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
  env?: Record<string, string>;
}

function runWrapper(opts: RunOptions) {
  const env: NodeJS.ProcessEnv = {
    HOME: process.env.HOME,
    PATH: opts.path ?? `${NODE_DIR}:/usr/bin:/bin`,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    STUB_EXIT: String(opts.stubExit ?? 0),
    ...opts.env,
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

  it('should allow, log gate-error and tell when the CLI exits 1, is missing, or ~/.oss/node-path is missing or names a node in a temp folder', () => {
    const failures: { name: string; mode: 'pre' | 'post'; run: () => ReturnType<typeof runWrapper> }[] = [
      { name: 'exit 1', mode: 'pre', run: () => runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), stubExit: 1 }) },
      { name: 'exit 3', mode: 'post', run: () => runWrapper({ mode: 'post', input: hookInput('PostToolUse'), stubExit: 3 }) },
      { name: 'killed', mode: 'pre', run: () => runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), stubExit: 137 }) },
      {
        name: 'no ~/.oss/node-path',
        mode: 'pre',
        run: () => {
          // and no node on PATH to record either (oss-node.sh records PATH's node when the record is missing)
          fs.rmSync(NODE_PATH_FILE, { force: true });
          const result = runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), path: noNodeBin });
          fs.writeFileSync(NODE_PATH_FILE, `${REAL_NODE}\n`, { mode: 0o600 });
          return result;
        },
      },
      {
        name: '~/.oss/node-path naming a link in a temp folder',
        mode: 'pre',
        run: () => {
          const link = path.join(caseRoot, 'node');
          fs.symlinkSync(REAL_NODE, link);
          fs.writeFileSync(NODE_PATH_FILE, `${link}\n`);
          // no node on PATH either (with one, the record counts as changed: tested below, round 8)
          return runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), path: noNodeBin });
        },
      },
      // Last: it removes the CLI for the cases after it.
      {
        name: 'missing CLI',
        mode: 'post',
        run: () => {
          fs.writeFileSync(NODE_PATH_FILE, `${REAL_NODE}\n`, { mode: 0o600 });
          fs.rmSync(path.join(pluginRoot, 'watcher/dist/cli/tool-gate.cjs'));
          return runWrapper({ mode: 'post', input: hookInput('PostToolUseFailure') });
        },
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

  it('should run node from ~/.oss/node-path when PATH has no node (no change for builders or the main agent)', () => {
    const allowed = runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), path: noNodeBin });

    expect(allowed.status).toBe(0);
    expect((JSON.parse(allowed.stdout) as { mode: string }).mode).toBe('pre');
    expect(eventsLog(project)).toBe('');
  });

  it('should never run a fake node, cat or mktemp placed first on PATH', () => {
    const fake = path.join(caseRoot, 'fake-bin');
    const marker = path.join(caseRoot, 'fake-ran');
    fs.mkdirSync(fake);
    for (const tool of ['node', 'cat', 'mktemp']) {
      fs.writeFileSync(path.join(fake, tool), `#!/bin/sh\necho ${tool} >> '${marker}'\nexit 0\n`, { mode: 0o755 });
    }

    const allowed = runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), path: `${fake}:${NODE_DIR}:/usr/bin:/bin` });
    const refused = runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), stubExit: 2, path: `${fake}:${NODE_DIR}:/usr/bin:/bin` });

    expect(fs.existsSync(marker)).toBe(false);
    expect(allowed.status).toBe(0);
    expect((JSON.parse(allowed.stdout) as { mode: string }).mode).toBe('pre');
    expect(refused.status).toBe(2);
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

/**
 * @behavior Round 8 (M4, HIGH-2, L1): when the gate itself can't answer (no recorded node, a CLI that
 *   fails, a gate still running at the hook's own deadline), a review agent's call is refused, while
 *   a builder's or the main agent's is allowed and told (ADR-005). A named pipe planted at the event
 *   log never hangs the hook, and rm, mkdir and date never run from PATH.
 * @business-rule R-266: a review agent's call that can't be checked is refused; a broken gate never
 *   blocks a builder or the main agent.
 */
describe('hooks/oss-tool-gate.sh round 8: review agents when the gate cannot answer', () => {
  function agentInput(agent: string | undefined): string {
    return JSON.stringify({
      session_id: 's-1',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo INPUT-MARKER-7f3a' },
      cwd: project,
      ...(agent === undefined ? {} : { agent_type: agent, agent_id: 'a-1' }),
    });
  }

  it('refuses every review agent when no node is recorded, and allows a builder and the main agent with the tell line', () => {
    fs.rmSync(NODE_PATH_FILE, { force: true });
    try {
      for (const agent of ['oss:code-reviewer', 'security-auditor', 'oss:penetration-tester', 'oss:performance-auditor']) {
        const result = runWrapper({ mode: 'pre', input: agentInput(agent), path: noNodeBin });
        expect(result.status, agent).toBe(2);
        expect(result.stderr, agent).toContain('the tool gate could not run (no recorded node)');
      }
      for (const agent of ['oss:typescript-pro', undefined]) {
        const result = runWrapper({ mode: 'pre', input: agentInput(agent), path: noNodeBin });
        expect(result.status, String(agent)).toBe(0);
        expect(result.stdout, String(agent)).toContain(TELL);
      }
    } finally {
      fs.writeFileSync(NODE_PATH_FILE, `${REAL_NODE}\n`, { mode: 0o600 });
    }
  });

  it('refuses a review agent when the gate CLI fails, and still passes the full input to the gate', () => {
    const refused = runWrapper({ mode: 'pre', input: agentInput('oss:code-reviewer'), stubExit: 1 });
    expect(refused.status).toBe(2);
    // the sandbox off, so the stub's bare allow stands (round 10, SEC INFO-1: on macOS one is refused)
    const passed = runWrapper({ mode: 'pre', input: agentInput('oss:code-reviewer'), env: { OSS_TOOL_GATE_SANDBOX: 'off' } });
    expect(passed.status).toBe(0);
    expect((JSON.parse(passed.stdout) as { input: string }).input).toBe(agentInput('oss:code-reviewer'));
  });

  it("keeps the hook's review-agent list the same as config/tool-gates.json's gateAgents", () => {
    const hookText = fs.readFileSync(WRAPPER, 'utf8');
    const listed = /GATE_AGENTS=" ([^"]*) "/.exec(hookText)?.[1]?.split(' ') ?? [];
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../config/tool-gates.json'), 'utf8')) as { gateAgents: string[] };
    expect(listed.sort()).toEqual([...config.gateAgents].sort());
  });

  it('does not hang on a named pipe planted at the event log, and a refusal stays fast', () => {
    fs.mkdirSync(path.join(project, '.oss/tool-gates'), { recursive: true });
    spawnSync('/usr/bin/mkfifo', [path.join(project, '.oss/tool-gates/events.ndjson')]);
    const started = Date.now();
    const builder = runWrapper({ mode: 'pre', input: agentInput('oss:typescript-pro'), stubExit: 1 });
    const reviewer = runWrapper({ mode: 'pre', input: agentInput('oss:code-reviewer'), stubExit: 1 });
    expect(builder.status).toBe(0);
    expect(reviewer.status).toBe(2);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  /**
   * Round 9 (D-R9-4): @behavior a gate still running at the hook's deadline is ended, and the call is
   * refused as too complex to check in time, for review agents, builders and the main agent alike.
   * @business-rule a call the gate can't finish checking in time is never let through unchecked.
   */
  it("ends a gate still running at the hook's own deadline and refuses every agent's call as too complex to check in time", async () => {
    const pidFile = path.join(caseRoot, 'stub.pid');
    const run = (agent: string | undefined) => {
      const started = Date.now();
      const result = spawnSync('/bin/bash', [WRAPPER, 'pre'], {
        input: agentInput(agent),
        env: { HOME: process.env.HOME, PATH: `${NODE_DIR}:/usr/bin:/bin`, CLAUDE_PLUGIN_ROOT: pluginRoot, STUB_HANG: pidFile },
        cwd: project,
        encoding: 'utf8',
        timeout: HANG_BACKSTOP_MS,
      });
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      stubPids.push(pid);
      return { result, ms: Date.now() - started, pid };
    };
    const reviewer = run('oss:code-reviewer');
    expect(reviewer.result.status).toBe(2);
    expect(reviewer.ms).toBeLessThan(5000);
    for (const agent of ['oss:typescript-pro', undefined]) {
      const other = run(agent);
      expect(other.result.status, String(agent)).toBe(2);
      expect(other.result.stdout, String(agent)).not.toContain(TELL);
      expect(other.result.stderr, String(agent)).toContain('too complex to check in time; split it into simpler commands');
    }
    expect(eventsLog(project)).not.toContain('"result":"allowed"');
    await waitFor(() => (isAlive(reviewer.pid) ? null : true), 3000);
    expect(isAlive(reviewer.pid)).toBe(false);
  }, 4 * HANG_BACKSTOP_MS);

  /**
   * Round 9 (CR INFO-1): @behavior once the gate answers, the hook leaves nothing running: its
   * deadline timer (a sleep) ends with it.
   * @business-rule a hook run on every tool call must not leave processes behind.
   */
  it('leaves no deadline timer running after the gate answers', async () => {
    const hook = spawn('/bin/bash', [WRAPPER, 'pre'], {
      env: { HOME: process.env.HOME, PATH: `${NODE_DIR}:/usr/bin:/bin`, CLAUDE_PLUGIN_ROOT: pluginRoot, STUB_EXIT: '0' },
      cwd: project,
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    hook.stdin.end(agentInput('oss:typescript-pro'));
    const group = hook.pid!;
    const code = await new Promise((resolve) => hook.once('exit', resolve));
    expect(code).toBe(0);
    const left = await waitFor(() => (spawnSync('/usr/bin/pgrep', ['-g', String(group)], { encoding: 'utf8' }).stdout.trim() === '' ? true : null), 1000);
    expect(left, spawnSync('/bin/ps', ['-o', 'pid,command', '-g', String(group)], { encoding: 'utf8' }).stdout).toBe(true);
  }, HANG_BACKSTOP_MS);

  /**
   * Round 9 (PERF MEDIUM-1): @behavior the hook finds a review agent in an input with thousands of
   * agent_type keys quickly, and counts more than four as a review agent's call.
   * @business-rule the hook answers in time on any input, and what it can't read cheaply fails closed.
   */
  it('reads 3,000 agent_type keys in under 0.5 s and takes more than one as a review agent', () => {
    fs.rmSync(NODE_PATH_FILE, { force: true });
    try {
      const keys = (n: number): string => `{"cwd":${JSON.stringify(project)},${'"agent_type":"oss:typescript-pro",'.repeat(n)}"tool_name":"Bash"}`;
      const started = Date.now();
      const many = runWrapper({ mode: 'pre', input: keys(3000), path: noNodeBin });
      expect(Date.now() - started).toBeLessThan(500);
      expect(many.status).toBe(2);
      // R-266 round 11, PERF LOW-2: no real call has two agent_type keys, so two fail closed
      expect(runWrapper({ mode: 'pre', input: keys(2), path: noNodeBin }).status).toBe(2);
      const one = runWrapper({ mode: 'pre', input: keys(1), path: noNodeBin });
      expect(one.status).toBe(0);
      expect(one.stdout).toContain(TELL);
      expect(runWrapper({ mode: 'pre', input: `{"agent_type":"oss:typescript-pro","agent_type":"OSS:Code-Reviewer"}`, path: noNodeBin }).status).toBe(2);
    } finally {
      fs.writeFileSync(NODE_PATH_FILE, `${REAL_NODE}\n`, { mode: 0o600 });
    }
  });

  /**
   * R-266 round 11, PERF LOW-2: @behavior a builder's call with a 100 KB heredoc, its agent_type
   * after tool_input, is answered in under 0.5 s; a review agent's is still refused.
   * @business-rule the hook answers in time on any input.
   */
  it('reads a 100 KB heredoc with agent_type after tool_input in under 0.5 s', () => {
    fs.rmSync(NODE_PATH_FILE, { force: true });
    try {
      const body = 'export const value = 1; // a line of generated source code\n'.repeat(1700);
      const input = (agent: string): string =>
        JSON.stringify({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `cat > src/big.ts <<'EOF'\n${body}EOF` }, agent_type: agent });
      expect(input('oss:typescript-pro').length).toBeGreaterThan(100_000);
      const started = Date.now();
      const builder = runWrapper({ mode: 'pre', input: input('oss:typescript-pro'), path: noNodeBin });
      expect(Date.now() - started).toBeLessThan(500);
      expect(builder.status).toBe(0);
      expect(builder.stdout).toContain(TELL);
      const started2 = Date.now();
      const review = runWrapper({ mode: 'pre', input: input('oss:code-reviewer'), path: noNodeBin });
      expect(Date.now() - started2).toBeLessThan(500);
      expect(review.status).toBe(2);
    } finally {
      fs.writeFileSync(NODE_PATH_FILE, `${REAL_NODE}\n`, { mode: 0o600 });
    }
  });

  it('never runs rm, mkdir or date from PATH', () => {
    const fake = path.join(caseRoot, 'fake-tools');
    const marker = path.join(caseRoot, 'fake-tool-ran');
    fs.mkdirSync(fake);
    for (const tool of ['rm', 'mkdir', 'date']) {
      fs.writeFileSync(path.join(fake, tool), `#!/bin/sh\necho ${tool} >> '${marker}'\nexit 0\n`, { mode: 0o755 });
    }
    runWrapper({ mode: 'pre', input: agentInput(undefined), stubExit: 1, path: `${fake}:${NODE_DIR}:/usr/bin:/bin` });
    runWrapper({ mode: 'pre', input: agentInput(undefined), path: `${fake}:${NODE_DIR}:/usr/bin:/bin` });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('refuses a review agent and tells everyone else when the recorded node changed, naming both nodes', () => {
    fs.writeFileSync(NODE_PATH_FILE, '/nonexistent/old/node\n', { mode: 0o600 });
    try {
      const refused = runWrapper({ mode: 'pre', input: agentInput('oss:security-auditor') });
      expect(refused.status).toBe(2);
      expect(refused.stderr).toContain('will not switch to a different node');
      expect(refused.stderr).toContain('/nonexistent/old/node');
      const told = runWrapper({ mode: 'pre', input: agentInput('oss:typescript-pro') });
      expect(told.status).toBe(0);
      const output = JSON.parse(told.stdout) as { hookSpecificOutput: { additionalContext: string }; systemMessage?: string };
      expect(output.hookSpecificOutput.additionalContext).toContain(TELL);
      expect(output.systemMessage).toContain('/nonexistent/old/node');
    } finally {
      fs.writeFileSync(NODE_PATH_FILE, `${REAL_NODE}\n`, { mode: 0o600 });
    }
  });
});


/**
 * Round 14 (SEC LOW-2 / PERF INFO-C): @behavior when a review agent's post call fails in the shell
 * (the gate killed at the hook's 4 s deadline, no answer, no recorded node, a crash), the hook voids
 * the run itself: it writes the run's tamper mark where and as the CLI does
 * (~/.oss/gate-state/<session_id>/<agent_id>.tamper, folders 0700, file 0600). A builder's or the
 * main agent's post call, and a review agent's pre call, mark nothing.
 * @business-rule R-266: a review agent's call the gate could not check afterwards may have swapped
 *   the code under review; the review is void.
 */
describe('hooks/oss-tool-gate.sh round 14: a review agent post call the gate could not finish voids the run', () => {
  const SESSION = 'r14-hook-s';
  const runDir = (): string => path.join(process.env.HOME ?? '', '.oss', 'gate-state', SESSION);
  const tamper = (agentId: string): string => path.join(runDir(), `${agentId}.tamper`);

  function postInput(agent: string | undefined, agentId: string): string {
    return JSON.stringify({
      session_id: SESSION,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_response: { stdout: '' },
      cwd: project,
      ...(agent === undefined ? {} : { agent_type: agent, agent_id: agentId }),
    });
  }

  afterEach(() => {
    fs.rmSync(runDir(), { recursive: true, force: true });
  });

  it.each<[string, Partial<RunOptions>]>([
    ['the gate crashed (exit 1)', { stubExit: 1 }],
    ['the gate was killed (no answer)', { stubExit: 137 }],
    ['no node is recorded', { path: undefined }],
  ])('%s: the tamper mark is written, private, in the CLI’s place and form', (what, extra) => {
    const agentId = `a-${what.length}`;
    const noNode = extra.path === undefined && extra.stubExit === undefined;
    if (noNode) fs.rmSync(NODE_PATH_FILE, { force: true });
    try {
      const result = runWrapper({ mode: 'post', input: postInput('oss:code-reviewer', agentId), ...extra, ...(noNode ? { path: noNodeBin } : {}) });
      expect(result.status).toBe(0);
      expect(fs.lstatSync(tamper(agentId)).isFile()).toBe(true);
      expect(fs.lstatSync(tamper(agentId)).mode & 0o777).toBe(0o600);
      expect(fs.lstatSync(runDir()).mode & 0o777).toBe(0o700);
      expect(fs.readFileSync(tamper(agentId), 'utf8')).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z\n$/);
      // round 14 C (D-R14-3): ~/.oss/gate-state, never the old ~/.oss/run/gate-run the served /oss:plan clean-up sweeps
      expect(fs.existsSync(path.join(process.env.HOME ?? '', '.oss', 'run', 'gate-run', SESSION))).toBe(false);
    } finally {
      fs.writeFileSync(NODE_PATH_FILE, `${REAL_NODE}\n`, { mode: 0o600 });
    }
  });

  it("the gate ended at the hook's 4 s deadline: the tamper mark is written", async () => {
    const pidFile = path.join(caseRoot, 'stub.pid');
    const result = spawnSync('/bin/bash', [WRAPPER, 'post'], {
      input: postInput('oss:code-reviewer', 'a-deadline'),
      env: { HOME: process.env.HOME, PATH: `${NODE_DIR}:/usr/bin:/bin`, CLAUDE_PLUGIN_ROOT: pluginRoot, STUB_HANG: pidFile },
      cwd: project,
      encoding: 'utf8',
      timeout: HANG_BACKSTOP_MS,
    });
    stubPids.push(Number(fs.readFileSync(pidFile, 'utf8')));
    expect(result.status).toBe(0);
    expect(fs.lstatSync(tamper('a-deadline')).isFile()).toBe(true);
  }, 2 * HANG_BACKSTOP_MS);

  it("a builder's or the main agent's failed post call, and a review agent's failed pre call, mark nothing", () => {
    runWrapper({ mode: 'post', input: postInput('oss:typescript-pro', 'a-builder'), stubExit: 1 });
    runWrapper({ mode: 'post', input: postInput(undefined, 'a-main'), stubExit: 1 });
    runWrapper({ mode: 'pre', input: postInput('oss:code-reviewer', 'a-pre').replace('PostToolUse', 'PreToolUse'), stubExit: 1 });
    expect(fs.existsSync(tamper('a-builder'))).toBe(false);
    expect(fs.existsSync(tamper('a-pre'))).toBe(false);
    expect(fs.existsSync(runDir()) ? fs.readdirSync(runDir()).filter((name) => name.endsWith('.tamper')) : []).toEqual([]);
  });

  it('never writes a mark for an unsafe session or agent id, nor through a symlinked state folder', () => {
    const unsafe = postInput('oss:code-reviewer', '../a-escape');
    runWrapper({ mode: 'post', input: unsafe, stubExit: 1 });
    expect(fs.existsSync(path.join(process.env.HOME ?? '', '.oss', 'gate-state', 'a-escape.tamper'))).toBe(false);
    const elsewhere = path.join(caseRoot, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.mkdirSync(path.dirname(runDir()), { recursive: true, mode: 0o700 });
    fs.symlinkSync(elsewhere, runDir());
    runWrapper({ mode: 'post', input: postInput('oss:code-reviewer', 'a-link'), stubExit: 1 });
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });
});

/**
 * Round 15 (CR I2): @behavior the gate CLI's answer is kept, until the hook reads it, in the gate's
 * protected state folder ~/.oss/gate-state (made 0700 by oss-node.sh oss_gate_state_dir), never in
 * ~/.oss/run/tool-gate, which the main agent and builders can write (a served /oss:plan block sweeps
 * ~/.oss/run). The file is removed once read.
 * @business-rule R-266: the gate's answer must not be forgeable by an agent the gate is judging.
 */
describe('hooks/oss-tool-gate.sh round 15: the answer file lives in the protected gate state', () => {
  const ossDir = (): string => path.join(process.env.HOME ?? '', '.oss');

  it("keeps the CLI's answer under ~/.oss/gate-state, private, and removes it afterwards", () => {
    const result = runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), env: { STUB_WHERE: '1' } });
    expect(result.status, result.stderr).toBe(0);
    const where = JSON.parse(result.stdout) as string[];
    expect(where).toHaveLength(1);
    const file = where[0] ?? '';
    expect(path.dirname(file)).toBe(path.join(ossDir(), 'gate-state'));
    expect(path.basename(file)).toMatch(/^out\.[A-Za-z0-9]{6}$/);
    expect(fs.lstatSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(ossDir(), 'run', 'tool-gate'))).toBe(false);
  });

  it('runs the gate in the foreground (no answer file) when the gate state folder is a symlink', () => {
    const elsewhere = path.join(caseRoot, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.rmSync(path.join(ossDir(), 'gate-state'), { recursive: true, force: true });
    fs.symlinkSync(elsewhere, path.join(ossDir(), 'gate-state'));
    try {
      const result = runWrapper({ mode: 'pre', input: hookInput('PreToolUse'), env: { STUB_WHERE: '1' } });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([]);
      expect(fs.readdirSync(elsewhere)).toEqual([]);
    } finally {
      fs.rmSync(path.join(ossDir(), 'gate-state'), { force: true });
    }
  });
});
