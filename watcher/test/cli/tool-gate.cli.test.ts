/**
 * @behavior The `tool-gate` command takes `pre` or `post` as its first argument and the hook
 *   JSON on stdin, and answers with the gate's exit code, stdout and stderr. Any other first
 *   argument is a wiring mistake: it exits 1 with a usage line, which the hook wrapper turns
 *   into allow-and-tell (it never blocks the call).
 * @business-rule US-010: a broken gate never blocks the session; exit 2 is reserved for refusals.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runCli } from '../../src/cli/tool-gate.js';

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

  it('should exit 1 with a usage line when the first argument is neither pre nor post', async () => {
    const repo = repoOnMain();

    const result = await runCli(['check'], pushHook(repo), { HOME: process.env.HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });

    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: 'Usage: tool-gate pre|post < hook.json\n' });
  });
});
