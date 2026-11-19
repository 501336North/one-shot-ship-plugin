/**
 * @behavior The main agent and builders can't sweep protected OSS files (the workflow state, the gate's
 *   own state) out of the worktree with `git stash`. `git stash -a` / `--all` is refused outright, since it
 *   also takes ignored files. `git stash -u` / `--include-untracked` is refused only when git's own dry run
 *   says it would take a protected path, or when the gate can't ask git (pathspecs from a file, git settings
 *   or `GIT_*` variables on the call, an earlier step that changes what is ignored or tracked, an option it
 *   doesn't know). Options are read as git reads them: bundled letters, `save`, long prefixes, and the last
 *   of include / no-include wins. Everyday stashes (`git stash`, `push -m`, `list`, `pop`, `-u` where the
 *   protected files are ignored or absent) stay allowed.
 * @business-rule gate-gaps-r3 Task 3 (R-266, finding #3; ADR-2: stash reuses git-clean's dry run, bounded
 *   to the protected paths, run from the repo root, failing closed; the git budget is 1.2 s).
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home and scratch repos, on darwin and linux.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateDeps, type GateResult } from '../../src/tool-gate/gate.js';
import { gitReaderFor, type GitReader } from '../../src/tool-gate/git-reader.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];
const PLATFORMS: NodeJS.Platform[] = ['darwin', 'linux'];

let root: string;
let home: string;
/** `.oss/workflow-state.json` untracked and not ignored. */
let swept: string;
/** `.oss/` gitignored. */
let ignored: string;
/** No protected file at all (nothing is refused there, so the gate's own refusal log never lands in it). */
let absent: string;
/** A large repo (an ignored node_modules, many untracked files) with the workflow state untracked. */
let large: string;

function gitRepo(dir: string): void {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export {};\n');
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir });
}

function workflowState(dir: string): void {
  fs.mkdirSync(path.join(dir, '.oss', 'tool-gates'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oss', 'workflow-state.json'), '{}\n');
}

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-git-stash-sweep-')));
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  swept = path.join(root, 'swept');
  gitRepo(swept);
  workflowState(swept);
  ignored = path.join(root, 'ignored');
  gitRepo(ignored);
  fs.writeFileSync(path.join(ignored, '.gitignore'), '.oss/\n');
  workflowState(ignored);
  absent = path.join(root, 'absent');
  gitRepo(absent);
  large = path.join(root, 'large');
  gitRepo(large);
  fs.writeFileSync(path.join(large, '.gitignore'), 'node_modules/\n');
  for (let p = 0; p < 400; p++) {
    const pkg = path.join(large, 'node_modules', `pkg${p}`, 'lib');
    fs.mkdirSync(pkg, { recursive: true });
    for (let f = 0; f < 25; f++) fs.writeFileSync(path.join(pkg, `f${f}.js`), '');
  }
  for (let d = 0; d < 40; d++) {
    const dir = path.join(large, 'scratch', `d${d}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let f = 0; f < 50; f++) fs.writeFileSync(path.join(dir, `u${f}.txt`), '');
  }
  workflowState(large);
}, 60_000);

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Each repo's info/exclude as git made it, keyed by repo. */
const freshExcludes = new Map<string, string>();

/**
 * Puts the repo's info/exclude back as git made it: the gate's own exclude (Task 3b), written when it
 * logs a refusal here, would otherwise hide the workflow state, and these rows are about a repo where
 * it is untracked and not ignored ("removed by hand before the command").
 */
function unexcluded(dir: string): void {
  const file = path.join(dir, '.git', 'info', 'exclude');
  if (!freshExcludes.has(dir)) freshExcludes.set(dir, fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, freshExcludes.get(dir) ?? '');
}

function call(command: string, agent: string | null, platform: NodeJS.Platform, cwd: string, deps: GateDeps = {}): Promise<GateResult> {
  unexcluded(cwd);
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'git-stash-sweep',
        cwd,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: cwd, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform, ...deps },
  );
}

/** This process's CPU time in milliseconds: the gate's decision deadline then counts work, not machine load. */
function cpuMs(): number {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
}

/** `git stash -a` / `--all` in any spelling: refused outright, wherever it runs. */
const ALL = [
  'git stash -a',
  'git stash --all',
  'git stash --al',
  'git stash push -a',
  'git stash push -a -m wip',
  'git stash push --all -m wip',
  'git stash -qa',
  'git stash -ka',
  'git stash save -a',
  'git stash save -a wip',
  'git stash -u --all',
];

/** `-u` forms that would take `.oss/workflow-state.json` in the swept repo. */
const UNTRACKED_SWEEPS = [
  'git stash -u',
  'git stash --include-untracked',
  'git stash --inc',
  'git stash push -u',
  'git stash push -u -m wip',
  'git stash push --include-untracked -- .oss',
  'git stash push -u -- .oss/workflow-state.json',
  'git stash -ku',
  'git stash -uq',
  'git stash save -u',
  'git stash save -u wip',
  'git stash --no-include-untracked -u',
  'cd src && git stash -u',
  'cd src && git stash push -u -m wip',
];

/** `-u` forms the gate can't ask git about: refused even where `.oss/` is ignored. */
const UNASKABLE = [
  'git stash push -u --pathspec-from-file=list.txt',
  'git stash push -u --pathspec-from-file list.txt',
  'git -c core.excludesFile=/dev/null stash -u',
  'git -c core.excludesfile=x stash push -u',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.excludesFile GIT_CONFIG_VALUE_0=/dev/null git stash -u',
  'GIT_CONFIG_GLOBAL=/dev/null git stash -u',
  'git stash push --frobnicate -u',
  'git stash -uZ',
  // an earlier step changes what is ignored or tracked, so a dry run asked now would be stale
  'git rm -q --cached .gitignore && git stash -u',
  "printf '' > .gitignore && git stash -u",
  'echo x >> .git/info/exclude; git stash -u',
];

/** Everyday stashes in the swept repo: none takes untracked files. */
const EVERYDAY = [
  'git stash',
  'git stash push',
  'git stash push -m wip',
  'git stash push -m "-u"',
  'git stash push -m -a',
  'git stash push -mwip -k',
  'git stash push -k -m wip',
  'git stash push --staged',
  'git stash push -p -- src',
  'git stash push -- src',
  'git stash -q',
  'git stash save wip',
  'git stash save -- -a',
  'git stash -u --no-include-untracked',
  'git stash push --include-untracked --no-include-untracked',
  'git stash list',
  'git stash show -p',
  'git stash pop',
  'git stash apply',
  'git stash drop',
];

describe.each(PLATFORMS)('on %s', (platform) => {
  describe.each(AGENTS)('%s', (_who, agent) => {
    async function decide(command: string, cwd: string): Promise<'refused' | 'allowed'> {
      const result = await call(command, agent, platform, cwd);
      return result.exitCode === 2 && /^Refused/.test(result.stderr) ? 'refused' : 'allowed';
    }

    async function wrongly(commands: string[], cwd: string, want: 'refused' | 'allowed'): Promise<string[]> {
      const wrong: string[] = [];
      for (const command of commands) if ((await decide(command, cwd)) !== want) wrong.push(command);
      return wrong;
    }

    it('refuses git stash -a / --all in every spelling, even where .oss is ignored', async () => {
      expect(await wrongly(ALL, swept, 'refused')).toEqual([]);
      expect(await wrongly(['git stash -a', 'git stash push --all'], ignored, 'refused')).toEqual([]);
    });

    it('refuses git stash -u when git says it would take an untracked protected file', async () => {
      expect(await wrongly(UNTRACKED_SWEEPS, swept, 'refused')).toEqual([]);
    });

    it('refuses git stash -u when the gate cannot ask git (fails closed)', async () => {
      expect(await wrongly(UNASKABLE, ignored, 'refused')).toEqual([]);
    });

    it('allows the everyday stashes beside them', async () => {
      expect(await wrongly(EVERYDAY, swept, 'allowed')).toEqual([]);
    });

    it('allows git stash -u where the protected files are gitignored or absent', async () => {
      const forms = ['git stash -u', 'git stash push -u -m wip', 'git stash --include-untracked', 'cd src && git stash -u'];
      expect(await wrongly(forms, ignored, 'allowed')).toEqual([]);
      expect(await wrongly(forms, absent, 'allowed')).toEqual([]);
    });

    it('never echoes the command text in a refusal', async () => {
      const result = await call('git stash push -a -m zq9marker', agent, platform, swept);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).not.toContain('zq9marker');
      const untracked = await call('git stash push -u -m zq9marker', agent, platform, swept);
      expect(untracked.exitCode).toBe(2);
      expect(untracked.stderr).not.toContain('zq9marker');
    });

    it('answers git stash -u in a large repo from a dry run bounded to the protected paths, well under the 1.2 s git budget', async () => {
      const real = gitReaderFor(large);
      const runs: { ms: number; pathspecs: string[] }[] = [];
      const timed: GitReader = {
        currentBranch: (dir, timeoutMs) => real.currentBranch(dir, timeoutMs),
        async wouldClean(dir, options, pathspecs, timeoutMs) {
          const started = performance.now();
          const removed = await real.wouldClean(dir, options, pathspecs, timeoutMs);
          runs.push({ ms: performance.now() - started, pathspecs });
          return removed;
        },
      };
      const result = await call('git stash -u', agent, platform, large, { gitReader: timed, clock: cpuMs });
      // refused because git said so, not because the gate couldn't tell
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('would take `.oss/');
      expect(runs.length).toBe(1);
      // bounded: only the protected paths are asked about, never the whole tree
      expect(runs[0].pathspecs.length).toBeGreaterThan(0);
      expect(runs[0].pathspecs.every((p) => p.startsWith(':/.oss/') || p.startsWith(':/.claude/'))).toBe(true);
      expect(runs[0].ms).toBeLessThan(1200);
    });
  });
});
