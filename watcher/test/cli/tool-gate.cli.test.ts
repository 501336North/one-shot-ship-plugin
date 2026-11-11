/**
 * @behavior The `tool-gate` command takes `pre` or `post` as its first argument and the hook
 *   JSON on stdin, and answers with the gate's exit code, stdout and stderr. Any other first
 *   argument is a wiring mistake: it exits 1 with a usage line, which the hook wrapper turns
 *   into allow-and-tell (it never blocks the call).
 *   The decision runs in a worker thread with a hard time limit: a decision stuck in
 *   synchronous work is ended at the limit, and the call is allowed with the tell line and a
 *   gate-error in the log (ADR-005), instead of leaving a process spinning.
 * @business-rule US-010: a broken gate never blocks the session; exit 2 is reserved for refusals.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { decideInWorker, runCli } from '../../src/cli/tool-gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const tempDirs: string[] = [];

function repoOnMain(): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-tool-gate-cli-')));
  tempDirs.push(repo);
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'initial'],
  ]) {
    execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  }
  return repo;
}

function pushHook(repo: string): string {
  return JSON.stringify({ cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push' } });
}

describe('tool-gate command line', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('should refuse a push from main when run as `tool-gate pre`', async () => {
    const repo = repoOnMain();

    const result = await runCli(['pre'], pushHook(repo), { HOME: process.env.HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('`main`');
  });

  it("should take the project folder from CLAUDE_PROJECT_DIR, so a planted .git can't unprotect the rule file", async () => {
    const repo = repoOnMain();
    const sub = path.join(repo, 'sub');
    fs.mkdirSync(path.join(sub, '.git'), { recursive: true });
    const write = JSON.stringify({
      cwd: sub,
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: path.join(repo, '.oss', 'tool-gates.json'), content: '{}' },
    });

    const result = await runCli(['pre'], write, {
      HOME: process.env.HOME,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      CLAUDE_PROJECT_DIR: repo,
    });

    expect(result.exitCode).toBe(2);
  });

  it("should read the base rules from the plugin, not from the working folder's config, when CLAUDE_PLUGIN_ROOT is unset", async () => {
    // Given: the working folder is a repo on main holding a lax config/tool-gates.json
    const repo = repoOnMain();
    const base = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'tool-gates.json'), 'utf8')) as object;
    fs.mkdirSync(path.join(repo, 'config'));
    fs.writeFileSync(path.join(repo, 'config', 'tool-gates.json'), JSON.stringify({ ...base, protectedBranches: ['nothing'] }));
    const startDir = process.cwd();
    process.chdir(repo);
    try {
      // When: the gate runs with no CLAUDE_PLUGIN_ROOT and the agent pushes
      const unset = await runCli(['pre'], pushHook(repo), { HOME: process.env.HOME });
      const empty = await runCli(['pre'], pushHook(repo), { HOME: process.env.HOME, CLAUDE_PLUGIN_ROOT: '' });

      // Then: the plugin's own rules refuse the push from main
      expect([unset.exitCode, empty.exitCode]).toEqual([2, 2]);
    } finally {
      process.chdir(startDir);
    }
  });

  it('should exit 1 with a usage line when the first argument is neither pre nor post', async () => {
    const repo = repoOnMain();

    const result = await runCli(['check'], pushHook(repo), { HOME: process.env.HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });

    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: 'Usage: tool-gate pre|post < hook.json\n' });
  });

  it("should return the worker's answer as it is", async () => {
    const repo = repoOnMain();
    const answering = path.join(repo, 'answering-decision.cjs');
    fs.writeFileSync(answering, "require('node:worker_threads').parentPort.postMessage({ exitCode: 2, stdout: '', stderr: 'Refused: x\\n' });\n");

    const result = await decideInWorker(answering, ['pre'], pushHook(repo), { HOME: process.env.HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });

    expect(result).toEqual({ exitCode: 2, stdout: '', stderr: 'Refused: x\n' });
  });

  it.each([
    ['stuck in synchronous work', 'for (;;) {}\n'],
    ['that crashes', "throw new Error('boom');\n"],
  ])('should end a decision %s within about 3 s, allow the call, tell the agent and log gate-error', async (_what, body) => {
    const repo = repoOnMain();
    const decision = path.join(repo, 'bad-decision.cjs');
    fs.writeFileSync(decision, body);

    const started = performance.now();
    const result = await decideInWorker(decision, ['pre'], pushHook(repo), { HOME: process.env.HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });

    expect(performance.now() - started).toBeLessThan(3000);
    const tell = { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'tool-gate failed, rules not checked.' } };
    expect(result).toEqual({ exitCode: 0, stdout: `${JSON.stringify(tell)}\n`, stderr: '' });
    const log = fs.readFileSync(path.join(repo, '.oss', 'tool-gates', 'events.ndjson'), 'utf8');
    expect(log).toContain('"kind":"gate-error"');
  });

  /**
   * A fake git for the decision to ask for: it starts a child that carries a unique token (so pgrep
   * can find it), records its process group (written whole, via a rename), and waits; ending its
   * group ends both. Run with `warm` it just exits.
   */
  function fakeGit(dir: string, token: string): { git: string; started: string } {
    const started = path.join(dir, 'started');
    const git = path.join(dir, 'git');
    fs.writeFileSync(
      git,
      `#!/bin/sh\n[ "$1" = warm ] && exit 0\n/bin/sh -c 'sleep 300; :' ${token} &\necho $$ > '${started}.tmp' && mv '${started}.tmp' '${started}'\nwait\n`,
      { mode: 0o755 },
    );
    // macOS checks a newly written program the first time it runs, which can take 0.5-1 s under load
    // and eat the whole time limit before the fake git starts its child: run it once, untimed, first.
    execFileSync(git, ['warm']);
    return { git, started };
  }

  /** A decision (worker) that asks the main thread to run `git`, then does `then` (JavaScript). */
  function decisionAsking(dir: string, git: string, then: string): string {
    const file = path.join(dir, 'decision.cjs');
    const run = { gitRun: { id: 1, gitBin: git, args: ['status'], cwd: dir, timeoutMs: 60000, maxLines: 10 } };
    fs.writeFileSync(file, [
      "const fs = require('node:fs');",
      "const { parentPort } = require('node:worker_threads');",
      `parentPort.postMessage(${JSON.stringify(run)});`,
      then,
      '',
    ].join('\n'));
    return file;
  }

  /** The processes still running whose command line holds `token`, or in process group `group` (pgrep). */
  function stillRunning(pattern: string[]): string {
    try {
      return execFileSync('pgrep', pattern, { encoding: 'utf8' }).trim();
    } catch {
      return ''; // pgrep exits 1 when nothing matches
    }
  }

  /** Waits (bounded) for nothing to match, so a SIGKILL has been delivered; returns what still matches. */
  async function settled(pattern: string[]): Promise<string> {
    // up to 5 s: on a loaded machine the kill can take a while to land
    for (let n = 0; n < 250; n++) {
      if (stillRunning(pattern) === '') return '';
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return stillRunning(pattern);
  }

  it('should end the whole process group of a git the decision asked for, when the decision hangs (fix round 4, K2)', async () => {
    // Given: a decision that asks for a long-running git, waits until it has started, then hangs
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-pg-')));
    tempDirs.push(dir);
    const token = `oss-pg-token-${path.basename(dir)}`;
    const { git, started } = fakeGit(dir, token);
    const decision = decisionAsking(dir, git, `while (!fs.existsSync(${JSON.stringify(started)})) {} for (;;) {}`);

    // When: the worker is ended at the hard limit (generous, so a loaded machine still starts the git in time)
    const result = await decideInWorker(decision, ['pre'], pushHook(repoOnMain()), { HOME: process.env.HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }, 5000);

    // Then: the call is allowed with the tell line, the git ran, and nothing of its group is left
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(started), 'the fake git started its child before the hard limit').toBe(true);
    const group = fs.readFileSync(started, 'utf8').trim();
    expect(Number(group)).toBeGreaterThan(0);
    expect(await settled(['-g', group])).toBe('');
    expect(await settled(['-f', token])).toBe('');
  }, 30_000);

  it('should end a git the decision asked for in the same moment it gave up, before any answer came back (fix round 4, K2)', async () => {
    // Given: a decision that asks for a git and at once posts something that is no answer
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-pg-')));
    tempDirs.push(dir);
    const token = `oss-pg-token-${path.basename(dir)}`;
    const { git } = fakeGit(dir, token);
    const decision = decisionAsking(dir, git, 'parentPort.postMessage({ not: "an answer" });');

    // When: the decision ends on the garbage
    const result = await decideInWorker(decision, ['pre'], pushHook(repoOnMain()), { HOME: process.env.HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });

    // Then: the call is allowed with the tell line, and no git (or child of it) is left running
    expect(result.exitCode).toBe(0);
    expect(await settled(['-f', token])).toBe('');
    expect(await settled(['-f', git])).toBe('');
  });

  it('should answer the git a decision asks for with what git prints (fix round 4, K2)', async () => {
    // Given: a decision that asks for `git --version` and posts back what it gets as its answer
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-pg-')));
    tempDirs.push(dir);
    const decision = decisionAsking(
      dir,
      'git',
      "parentPort.on('message', (m) => { if (m.gitResult) parentPort.postMessage({ exitCode: 0, stdout: String(m.gitResult.out).slice(0, 11), stderr: '' }); });",
    );
    fs.writeFileSync(decision, fs.readFileSync(decision, 'utf8').replace('["status"]', '["--version"]'));

    // When / Then: the main thread ran git and handed its output back
    const result = await decideInWorker(decision, ['pre'], pushHook(repoOnMain()), { HOME: process.env.HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
    expect(result).toEqual({ exitCode: 0, stdout: 'git version', stderr: '' });
  });
});
