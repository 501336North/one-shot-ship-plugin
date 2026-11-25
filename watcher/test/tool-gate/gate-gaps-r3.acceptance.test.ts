/**
 * @behavior The main agent and builders can't run an OSS hook with a changed HOME or PATH by hiding the
 *   call behind word splitting or a value the gate can't read, can't sweep protected OSS files away with
 *   `git stash -a` / `-u`, and can't rewrite or erase git's ref history (`update-ref`, reflog settings,
 *   `reflog expire`, writes under `.git/logs`). Everyday commands next to each refusal stay allowed.
 * @business-rule gate-gaps-r3 (R-266 fix PR), user picks 2026-11-19: "1, 3 and narrow 4"; Q1 "Refuse it,
 *   measure first"; Q2 "Rely on the snapshot" (plain fetch and push stay allowed).
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home and scratch repos.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS: Array<[string, string | null]> = [['the main agent', null], ['a builder', 'oss:typescript-pro']];

let root: string;
let home: string;
let repo: string;
let ignoredRepo: string;
/** The repo's info/exclude as git made it: put back before each refused row, so the gate's own exclude (Task 3b) can't hide the workflow state. */
let freshExclude: string;
/** A repo with the workflow state untracked and not ignored, for Task 3b's row. */
let customerRepo: string;

function gitRepo(dir: string): void {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
}

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-gate-gaps-r3-')));
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.oss', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.oss', 'hooks', 'oss-log.sh'), '#!/bin/sh\n');
  // a repo where a protected OSS file is untracked and not ignored
  repo = path.join(root, 'repo');
  gitRepo(repo);
  fs.mkdirSync(path.join(repo, '.oss'));
  fs.writeFileSync(path.join(repo, '.oss', 'workflow-state.json'), '{}\n');
  freshExclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
  customerRepo = path.join(root, 'customer');
  gitRepo(customerRepo);
  fs.mkdirSync(path.join(customerRepo, '.oss'));
  fs.writeFileSync(path.join(customerRepo, '.oss', 'workflow-state.json'), '{}\n');
  // a repo where .oss is gitignored
  ignoredRepo = path.join(root, 'ignored');
  gitRepo(ignoredRepo);
  fs.writeFileSync(path.join(ignoredRepo, '.gitignore'), '.oss/\n');
  fs.mkdirSync(path.join(ignoredRepo, '.oss'));
  fs.writeFileSync(path.join(ignoredRepo, '.oss', 'workflow-state.json'), '{}\n');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(command: string, agent: string | null, cwd: string): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'gate-gaps-r3',
        cwd,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: cwd, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform: 'linux' },
  );
}

async function decide(command: string, agent: string | null, cwd: string): Promise<'refused' | 'allowed'> {
  const result = await call(command, agent, cwd);
  return result.exitCode === 2 && /^Refused/.test(result.stderr) ? 'refused' : 'allowed';
}

const hook = (): string => path.join(home, '.oss', 'hooks', 'oss-log.sh');

const REFUSED_IN_REPO = (): string[] => [
  // Task 2: a hook call hidden by word splitting, or behind a value the gate can't read
  `c="env HOME=/x ${hook()}"; $c init build`,
  'p=.oss/ho; q=oks; c="env HOME=/x $HOME/$p$q/oss-log.sh"; $c init build',
  'c=$(cat /tmp/f); $c init build',
  `echo 'env HOME=/x ${hook()} init build' | xargs`,
  // Task 3: stash sweeping protected OSS files
  'git stash -a',
  'git stash --all',
  'git stash -u',
  // Task 4: ref history
  'git update-ref refs/remotes/origin/x HEAD',
  'git -c core.logAllRefUpdates=false commit -m x',
  'git reflog expire --expire=now HEAD',
  'echo x > .git/logs/HEAD',
  // Tasks 7-10: R-257 gate round 4 (user pick D47), folded in 2026-11-19
  'git fetch . HEAD:refs/remotes/origin/x',
  'git push . HEAD:refs/remotes/origin/x',
  'git fetch origin main:refs/remotes/origin/x',
  'git config oss.shipBase wip',
  'git -c oss.shipBase=wip status',
  'printf x >> ~/.claude/projects/p/s.jsonl',
  'mkdir -p ~/.claude/projects/p/s/subagents',
  "find \"$CLAUDE_PLUGIN_ROOT\"/watcher/dist -name 'v*e.cjs' -exec node {} start i1.json \\;",
  "find \"$CLAUDE_PLUGIN_ROOT\"/watcher/dist -name 'v*e.cjs' | xargs node",
];

const ALLOWED_IN_REPO = (): string[] => [
  'c=ls; $c -la',
  `${hook()} init build`,
  'git stash push -m wip',
  'git stash list',
  'git fetch origin',
  'git log -g',
  'cat .git/logs/HEAD',
  'git config --get core.logAllRefUpdates',
  'git fetch origin main',
  'git push -u origin feat/x',
  'git config user.email a@b.c',
  'git config --get oss.shipBase',
  'printf x > ~/.claude/projects/p/memory/m.md',
  "find src -name '*.ts' -exec grep -l x {} +",
];

describe('gate-gaps-r3: hook calls, stash sweeps and ref history (acceptance)', () => {
  for (const [who, agent] of AGENTS) {
    it(`refuses each hidden hook call, stash sweep and ref-history write for ${who}`, async () => {
      const wrong: string[] = [];
      for (const command of REFUSED_IN_REPO()) {
        fs.writeFileSync(path.join(repo, '.git', 'info', 'exclude'), freshExclude);
        if ((await decide(command, agent, repo)) !== 'refused') wrong.push(command);
      }
      expect(wrong).toEqual([]);
    });

    it(`keeps the everyday commands beside them allowed for ${who}`, async () => {
      const wrong: string[] = [];
      for (const command of ALLOWED_IN_REPO()) if ((await decide(command, agent, repo)) !== 'allowed') wrong.push(command);
      expect(wrong).toEqual([]);
    });

    it(`allows git stash -u when .oss is gitignored for ${who}`, async () => {
      expect(await decide('git stash -u', agent, ignoredRepo)).toBe('allowed');
    });

    it(`allows git stash -u after a refusal wrote the gate's event log, in a repo that doesn't ignore .oss, for ${who}`, async () => {
      expect(await decide('git stash -a', agent, customerRepo)).toBe('refused');
      expect(fs.existsSync(path.join(customerRepo, '.oss', 'tool-gates', 'events.ndjson'))).toBe(true);
      expect(await decide('git stash -u', agent, customerRepo)).toBe('allowed');
    });
  }
});
