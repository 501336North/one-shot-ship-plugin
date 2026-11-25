/**
 * @behavior When the gate writes its own state (`.oss/tool-gates/`) in a repo, it lists that folder and
 *   `.oss/workflow-state.json` in the repo's local `info/exclude`, in the git common dir that every
 *   worktree shares. So a customer repo that doesn't ignore `.oss/` keeps `git stash -u` after the gate's
 *   first refusal there, and `git status` stays clean of OSS state. The step is local only (never
 *   committed), adds no duplicate lines, adds nothing git already ignores, leaves a symlinked
 *   `info/exclude` or `info/` alone, and never changes a gate decision.
 * @business-rule gate-gaps-r3 Task 3b (R-266), user pick 2026-11-19 "Gate excludes its own folder locally".
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home and scratch repos.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STATE_LINES = ['.oss/tool-gates/', '.oss/workflow-state.json'];

let root: string;
let home: string;
let count = 0;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-state-exclude-')));
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A fresh repo with the workflow state untracked and not ignored, as OSS hooks leave it in a customer repo. */
function customerRepo(): string {
  const dir = path.join(root, `repo${++count}`);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export {};\n');
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.oss'));
  fs.writeFileSync(path.join(dir, '.oss', 'workflow-state.json'), '{}\n');
  return dir;
}

async function decide(command: string, cwd: string): Promise<'refused' | 'allowed'> {
  const result = await runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({ session_id: 'oss-state-exclude', cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: cwd, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform: 'linux' },
  );
  return result.exitCode === 2 && /^Refused/.test(result.stderr) ? 'refused' : 'allowed';
}

const excludeFile = (gitDir: string): string => path.join(gitDir, 'info', 'exclude');
const lines = (file: string): string[] => fs.readFileSync(file, 'utf8').split('\n');
const ossStatus = (dir: string): string[] =>
  execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes('.oss'));

describe('the gate excludes its own state locally so git stash -u keeps working', () => {
  it('after a first refusal writes the event log, git stash -u is allowed and git status lists nothing under .oss', async () => {
    const repo = customerRepo();
    expect(await decide('git stash -a', repo)).toBe('refused');
    expect(fs.existsSync(path.join(repo, '.oss', 'tool-gates', 'events.ndjson'))).toBe(true);
    expect(await decide('git stash -u', repo)).toBe('allowed');
    expect(ossStatus(repo)).toEqual([]);
  });

  it('a second refusal adds no duplicate lines', async () => {
    const repo = customerRepo();
    await decide('git stash -a', repo);
    await decide('git stash --all', repo);
    const file = excludeFile(path.join(repo, '.git'));
    for (const line of STATE_LINES) expect(lines(file).filter((l) => l === line)).toHaveLength(1);
  });

  it('only appends: what the exclude file held before stays as it was, first', async () => {
    const repo = customerRepo();
    const file = excludeFile(path.join(repo, '.git'));
    fs.writeFileSync(file, '# mine\n*.local');
    await decide('git stash -a', repo);
    expect(fs.readFileSync(file, 'utf8').startsWith('# mine\n*.local\n')).toBe(true);
  });

  it('in a linked worktree, the exclude lands in the common git dir that every worktree shares', async () => {
    const main = customerRepo();
    const tree = path.join(root, `tree${++count}`);
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'feat/tree', tree], { cwd: main });
    fs.mkdirSync(path.join(tree, '.oss'));
    fs.writeFileSync(path.join(tree, '.oss', 'workflow-state.json'), '{}\n');
    expect(await decide('git stash -a', tree)).toBe('refused');
    const common = lines(excludeFile(path.join(main, '.git')));
    for (const line of STATE_LINES) expect(common).toContain(line);
    expect(fs.existsSync(excludeFile(path.join(main, '.git', 'worktrees', path.basename(tree))))).toBe(false);
    expect(await decide('git stash -u', tree)).toBe('allowed');
    expect(ossStatus(tree)).toEqual([]);
  });

  it('leaves a symlinked info/exclude alone, and the decision stands', async () => {
    const repo = customerRepo();
    const target = path.join(root, `elsewhere${++count}`);
    fs.writeFileSync(target, 'theirs\n');
    const file = excludeFile(path.join(repo, '.git'));
    fs.rmSync(file);
    fs.symlinkSync(target, file);
    expect(await decide('git stash -a', repo)).toBe('refused');
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('theirs\n');
    expect(await decide('git stash -u', repo)).toBe('refused');
  });

  it('leaves a symlinked info/ folder alone, and the decision stands', async () => {
    const repo = customerRepo();
    const target = path.join(root, `elsewhere${++count}`);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'exclude'), 'theirs\n');
    const info = path.join(repo, '.git', 'info');
    fs.rmSync(info, { recursive: true });
    fs.symlinkSync(target, info);
    expect(await decide('git stash -a', repo)).toBe('refused');
    expect(fs.readFileSync(path.join(target, 'exclude'), 'utf8')).toBe('theirs\n');
    expect(await decide('git stash -u', repo)).toBe('refused');
  });

  it('adds nothing in a repo that already ignores .oss/', async () => {
    const repo = customerRepo();
    fs.writeFileSync(path.join(repo, '.gitignore'), '.oss/\n');
    const file = excludeFile(path.join(repo, '.git'));
    const before = fs.readFileSync(file, 'utf8');
    expect(await decide('git stash -a', repo)).toBe('refused');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('still refuses git stash -u when the exclude was removed by hand before the command', async () => {
    const repo = customerRepo();
    const file = excludeFile(path.join(repo, '.git'));
    const before = fs.readFileSync(file, 'utf8');
    await decide('git stash -a', repo);
    fs.writeFileSync(file, before);
    expect(await decide('git stash -u', repo)).toBe('refused');
  });
});
