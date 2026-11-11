/**
 * @behavior The gate reads a rule file only when it is an ordinary file under 1 MB. A named
 *   pipe (FIFO), a device or a folder at `.oss/tool-gates.json` is ignored and reported, the
 *   same way as a malformed repo file, and the gate answers at once instead of waiting on it.
 *   A plugin base file that is not an ordinary file is a gate error, also answered at once.
 * @business-rule US-009 / US-010: a repo can't stall the gate with a special file at its rule
 *   path (a stalled gate hits the hook's time limit, and the hook then allows the call).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** Well under the 3 s after which the helper below unblocks an old-style read of the pipe. */
const ANSWER_MS = 1000;

const tempDirs: string[] = [];
const helpers: ChildProcess[] = [];

afterEach(() => {
  for (const child of helpers.splice(0)) child.kill('SIGKILL');
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

/** A named pipe at the path. After 3 s a helper opens and closes it, so a read that waits on it ends. */
function makeFifo(absPath: string): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  execFileSync('mkfifo', [absPath]);
  // Opening read-write never blocks, and the shell exits right after, so the helper never lingers.
  helpers.push(spawn('sh', ['-c', 'sleep 3; exec 3<>"$0"', absPath], { stdio: 'ignore' }));
}

function makeRepo(): string {
  const repo = tempDir('oss-tool-gate-rule-read-');
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

async function preLs(repo: string, pluginRoot = PLUGIN_ROOT): Promise<{ result: GateResult; ms: number }> {
  const start = Date.now();
  const result = await runToolGate({
    mode: 'pre',
    input: JSON.stringify({ cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }),
    env: { HOME: tempDir('oss-tool-gate-rule-read-home-'), CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PROJECT_DIR: repo },
  });
  return { result, ms: Date.now() - start };
}

describe('rule files that are not ordinary files', () => {
  it('ignores and reports a named pipe at .oss/tool-gates.json, answering at once', async () => {
    const repo = makeRepo();
    makeFifo(path.join(repo, '.oss', 'tool-gates.json'));

    const { result, ms } = await preLs(repo);

    expect(ms).toBeLessThan(ANSWER_MS);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('.oss/tool-gates.json ignored: not a regular file under 1 MB');
  });

  it('ignores and reports a folder at .oss/tool-gates.json', async () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, '.oss', 'tool-gates.json'), { recursive: true });

    const { result } = await preLs(repo);

    expect(result.stdout).toContain('.oss/tool-gates.json ignored: not a regular file under 1 MB');
  });

  it('ignores and reports a repo rule file over 1 MB without reading it', async () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, '.oss'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.oss', 'tool-gates.json'), ' '.repeat(1024 * 1024 + 1));

    const { result } = await preLs(repo);

    expect(result.stdout).toContain('.oss/tool-gates.json ignored: not a regular file under 1 MB');
  });

  it('treats a named pipe as the plugin base file as a gate error, answering at once', async () => {
    const repo = makeRepo();
    const pluginRoot = tempDir('oss-tool-gate-plugin-');
    makeFifo(path.join(pluginRoot, 'config', 'tool-gates.json'));

    const { result, ms } = await preLs(repo, pluginRoot);

    expect(ms).toBeLessThan(ANSWER_MS);
    expect(result.stdout).toContain('tool-gate failed, rules not checked.');
  });
});
