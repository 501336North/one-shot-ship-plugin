/**
 * @behavior Round 15 (PERF INFO-1): the nested-repo scan's git runs are started by the CLI's main
 *   thread, in their own process group, like every other git the decision asks for. So when the CLI is
 *   ended with TERM mid-scan (the hook's deadline, or Claude Code giving up on the hook), no git (or
 *   anything it started) is left running. The scan's output file is unlinked the moment it is opened,
 *   so nothing of it is left on disk either, whenever the CLI dies.
 * @business-rule R-266: the gate leaves no process and no file behind after a call.
 * @boundary The real CLI main thread (runMain, bundled with esbuild into a child node process) and a
 *   decision worker that runs the real nested-repo scan (nestedRepos) against a fake git that hangs.
 *   Hermetic: scratch folders, HOME is the test run's temp home, no network.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop() ?? '', { recursive: true, force: true });
});

function bundle(code: string, out: string): void {
  buildSync({ stdin: { contents: code, resolveDir: SRC, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent' });
}

function pgrep(pattern: string[]): string {
  try {
    return execFileSync('pgrep', pattern, { encoding: 'utf8' }).trim();
  } catch {
    return ''; // pgrep exits 1 when nothing matches
  }
}

async function waitFor(probe: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (probe()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return probe();
}

/** Every file named `out` under `dir`. */
function outFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((name) => path.basename(name) === 'out');
}

describe('PERF INFO-1: a CLI ended with TERM mid-scan leaves no nested-repo git and no output file', () => {
  it('kills the scan git group and leaves no `out` file', async () => {
    const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r15a-term-')));
    dirs.push(work);
    const top = path.join(work, 'repo');
    fs.mkdirSync(top);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: top, stdio: 'ignore' });
    const tempRoot = path.join(work, 'temp');
    fs.mkdirSync(tempRoot);
    // the fake git: records its group once its sleeper (carrying the fake's unique path) has started
    const fakeGit = path.join(work, `fake-git-${process.pid}`);
    const groups = path.join(work, 'groups');
    fs.mkdirSync(groups);
    const started = (): string[] => fs.readdirSync(groups).filter((name) => /^\d+$/.test(name));
    fs.writeFileSync(fakeGit, `#!/bin/sh\n[ "$1" = warm ] && exit 0\n/usr/bin/perl -e 'sleep 300' -- "$0" "$@" &\n: > "${groups}/$$.tmp" && mv "${groups}/$$.tmp" "${groups}/$$"\nwait\n`, { mode: 0o755 });
    // macOS checks a newly written program the first time it runs (seconds under load): done here, outside the waits
    execFileSync(fakeGit, ['warm']);
    const decision = path.join(work, 'decision.cjs');
    bundle(
      [
        "import { parentPort } from 'node:worker_threads';",
        "import { nestedGitViaPort, nestedRepos } from './tool-gate/nested-repos.js';",
        'if (parentPort !== null) nestedGitViaPort(parentPort);',
        `void nestedRepos(${JSON.stringify(top)}, { gitDir: ${JSON.stringify(path.join(top, '.git'))}, commonDir: ${JSON.stringify(path.join(top, '.git'))} }, [], { tempRoot: ${JSON.stringify(tempRoot)}, gitBin: ${JSON.stringify(fakeGit)} });`,
        'setInterval(() => {}, 1000);',
      ].join('\n'),
      decision,
    );
    const main = path.join(work, 'main.cjs');
    bundle(`import { runMain } from './cli/tool-gate.js';\nrunMain(${JSON.stringify(decision)}, ['pre']);\n`, main);

    const cli = spawn(process.execPath, [main], { stdio: ['pipe', 'ignore', 'ignore'], env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? work } });
    cli.stdin.end(JSON.stringify({ cwd: top, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(top, 'x') } }));
    const exited = new Promise<NodeJS.Signals | null>((resolve) => cli.once('exit', (_code, signal) => resolve(signal)));
    try {
      // both scan gits (ls-files --others and --stage) are running
      expect(await waitFor(() => started().length === 2, 10_000)).toBe(true);
      expect(await waitFor(() => pgrep(['-f', fakeGit]).split('\n').filter((l) => l !== '').length >= 2, 5_000)).toBe(true);
      // the output files were unlinked as soon as they were opened
      expect(outFiles(tempRoot)).toEqual([]);

      cli.kill('SIGTERM');
      // still ended by TERM, as the hook expects (exit 143: refused as too complex to check in time)
      expect(await exited).toBe('SIGTERM');

      expect(await waitFor(() => pgrep(['-f', fakeGit]) === '', 5_000), `left running: ${pgrep(['-f', fakeGit])}`).toBe(true);
      expect(outFiles(tempRoot)).toEqual([]);
    } finally {
      cli.kill('SIGKILL');
      for (const group of started()) {
        try {
          process.kill(-Number(group), 'SIGKILL');
        } catch {
          // already gone
        }
      }
      for (const pid of pgrep(['-f', fakeGit]).split('\n').filter((l) => l !== '')) {
        try {
          process.kill(Number(pid), 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
  }, 30_000);
});
