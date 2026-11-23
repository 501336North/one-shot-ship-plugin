/**
 * @behavior The main agent and builders can't forge a remote-tracking ref (refs/remotes/…), which the
 *   ship base is read from. Refused: a fetch or push whose remote is the repo itself (`.`, its path,
 *   absolute or relative, `$PWD`, a `file://` URL to it, or one of its worktrees); any explicit fetch,
 *   pull or push refspec (or fetch `--refmap`) whose destination is under refs/remotes/, for any remote
 *   name, `+` forms and wildcards included; a `git symbolic-ref` write of a ref under refs/remotes/; and
 *   a remote pointed at a local path or a `file://` URL (`git remote add`, `set-url` with `--add` /
 *   `--push`, `-c remote.<name>.url|pushurl=`, `--config-env`, `GIT_CONFIG_KEY_n`, `git config`).
 *   Everyday fetch, pull and push, symbolic-ref reads and HEAD switches, and remotes on real hosts stay allowed.
 * @business-rule gate-gaps-r3 Task 7 (R-266): owner pick "Refuse self-source and refs/remotes/ targets"
 *   (Q2 re-ask, 2026-11-19), D50 (the ship base can be on any remote), and R-257 gate round 5 picks
 *   (symbolic-ref and local remotes folded in). Refusal reasons are fixed text and don't echo values.
 * @boundary runToolGate (the gate as the hook calls it), with a scratch home, a scratch repo and a
 *   worktree of it, on darwin and linux.
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
const PLATFORMS: NodeJS.Platform[] = ['darwin', 'linux'];

// made when the file loads: the rows name the repo and its worktree by path
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-remote-ref-forge-')));
const home = path.join(root, 'home');
const repo = path.join(root, 'repo');
const worktree = path.join(root, 'wt');

beforeAll(() => {
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'feat/wt', worktree], { cwd: repo });
  // ship round 1, S3a: the default mapping is allowed only for a remote in the repo's git config
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/x.git'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'upstream', 'https://github.com/example/up.git'], { cwd: repo });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function call(command: string, agent: string | null, platform: NodeJS.Platform): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: 'remote-ref-forge',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        ...(agent === null ? {} : { agent_type: agent }),
      }),
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
      hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
    },
    { platform },
  );
}

const SELF_REMOTE = (): string[] => [
  'git fetch . HEAD:refs/remotes/origin/x',
  'git push . HEAD:refs/remotes/origin/x',
  'git fetch .',
  `git fetch ${repo} HEAD:refs/heads/y`,
  'git fetch ../repo HEAD:refs/heads/y',
  `git fetch ${worktree} feat/wt:refs/heads/y`,
  `git push ${repo} HEAD:refs/heads/y`,
  `git push ${worktree} HEAD:refs/heads/y`,
  `git fetch file://${repo} HEAD:refs/heads/y`,
];

const REMOTE_TRACKING_DESTINATION = [
  'git fetch origin main:refs/remotes/origin/x',
  'git fetch origin +main:refs/remotes/origin/x',
  'git fetch upstream main:refs/remotes/upstream/x',
  'git fetch fork main:remotes/fork/main',
  "git fetch origin '+refs/heads/*:refs/remotes/fork/*'",
  "git fetch origin '+refs/*:refs/*'",
  'git fetch origin main:REFS/REMOTES/origin/x',
  "git fetch --refmap='+refs/heads/*:refs/remotes/origin/*' origin main",
  "git fetch --refmap '+refs/heads/*:refs/remotes/origin/*' origin main",
  'git pull origin main:refs/remotes/origin/x',
  'git push origin HEAD:refs/remotes/origin/main',
  'git push origin +HEAD:refs/remotes/upstream/main',
  'git push origin refs/remotes/origin/main',
  // Task 7 picks: only the exact default mapping of a named remote is allowed
  'git fetch origin main:refs/remotes/upstream/main',
  'git fetch origin main:refs/remotes/origin/other',
  "git fetch origin 'refs/heads/*:refs/remotes/origin/*'",
  'git pull origin main:refs/remotes/upstream/main',
  'git fetch "$R" main:refs/remotes/origin/main',
  'git fetch ./origin main:refs/remotes/origin/main',
];

// Task 7 picks ("Fold all three into Task 7")
const MORE_ROUTES = [
  'git -c url./tmp/x.insteadOf=https://github.com/ fetch origin',
  'git -c url.file:///tmp/x.pushInsteadOf=git@github.com: fetch',
  'git -c URL.../repo.INSTEADOF=https://github.com/ fetch origin',
  'git --config-env=url./tmp/x.insteadOf=V fetch origin',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url./tmp/x.insteadOf GIT_CONFIG_VALUE_0=https://github.com/ git fetch origin',
  'git config url./tmp/x.insteadOf https://github.com/',
  "git -c 'remote.origin.fetch=+refs/remotes/*:refs/remotes/*' fetch origin",
  "git -c 'remote.origin.fetch=+refs/heads/*:refs/remotes/upstream/*' fetch origin",
  'git --config-env=remote.origin.fetch=V fetch origin',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.fetch GIT_CONFIG_VALUE_0=+refs/heads/main:refs/remotes/origin/x git fetch origin',
  'git remote -v add --mirror m https://github.com/a/b.git',
  'git remote --verbose add --mirror=fetch m https://github.com/a/b.git',
];

const SYMBOLIC_REF_WRITES = [
  'git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/feat',
  'git symbolic-ref -d refs/remotes/origin/HEAD',
  'git symbolic-ref --delete refs/remotes/upstream/HEAD',
  'git symbolic-ref -m msg refs/remotes/upstream/HEAD refs/remotes/upstream/x',
];

const LOCAL_REMOTE_URLS = (): string[] => [
  'git remote add self .',
  'git remote add self ..',
  `git remote add self ${repo}`,
  'git remote add self ../repo',
  'git remote add self ~/x',
  'git remote add self "$DIR"',
  'git remote add self "$SCHEME://host/x"',
  'git remote add self somefolder',
  'git remote add self file:///tmp/x',
  'git remote add -f -t main self /tmp/x',
  'git remote -v add self .',
  'git remote set-url origin /tmp/x',
  'git remote set-url --push origin /tmp/x',
  'git remote set-url --add origin ./x',
  'git remote set-url --add --push origin file:///tmp/x',
  'git -c remote.origin.url=/tmp/x fetch',
  'git -c remote.origin.pushurl=. fetch origin',
  'git -c REMOTE.origin.URL=/tmp/x fetch',
  'git --config-env=remote.origin.url=V fetch',
  'git --config-env remote.origin.url=V fetch',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.url GIT_CONFIG_VALUE_0=/tmp/x git fetch',
  'git config remote.origin.url /tmp/x',
];

const ALLOWED = [
  // Task 7 picks: the default mapping of a named remote, and remotes only known when it runs
  'git fetch origin main:refs/remotes/origin/main',
  'git fetch origin +main:refs/remotes/origin/main',
  'git fetch upstream refs/heads/main:refs/remotes/upstream/main',
  'git pull origin main:refs/remotes/origin/main',
  'git fetch "$PWD" HEAD:refs/heads/y',
  'git push "$REMOTE" "$BRANCH"',
  "git -c 'remote.origin.fetch=+refs/heads/*:refs/remotes/origin/*' fetch origin",
  "git -c 'remote.origin.fetch=refs/heads/*:refs/remotes/origin/*' fetch origin",
  'git -c url.https://mirror.example.com/.insteadOf=https://github.com/ fetch origin',
  'git fetch origin',
  'git fetch origin main',
  'git fetch --all',
  'git fetch upstream',
  'git pull',
  'git pull --rebase',
  'git pull origin main',
  'git push -u origin feat/x',
  'git push origin HEAD:feat/x',
  'git fetch origin main:feat/local',
  'git symbolic-ref HEAD',
  'git symbolic-ref --short HEAD',
  'git symbolic-ref HEAD refs/heads/x',
  'git remote -v',
  'git remote add upstream https://github.com/a/b.git',
  'git remote add fork git@github.com:a/b.git',
  'git remote set-url origin ssh://host/x.git',
  // the served /oss:plan step: a host URL whose later parts are only known when it runs
  'git remote add origin "https://github.com/$(gh api user -q .login)/$REPO_NAME.git"',
  'git remote add fork "git@github.com:$GH_USER/b.git"',
  'git -c remote.origin.url=https://github.com/a/b.git fetch',
];

describe.each(PLATFORMS)('remote-tracking refs can\'t be forged (gate-gaps-r3 Task 7) on %s', (platform) => {
  describe.each(AGENTS)('%s', (_label, agent) => {
    async function refused(command: string): Promise<void> {
      const result = await call(command, agent, platform);
      expect(result.exitCode, command).toBe(2);
      expect(result.stderr, command).toMatch(/^Refused/);
    }

    it.each(SELF_REMOTE())('should refuse a fetch or push whose remote is the repo itself: %s', async (command) => {
      await refused(command);
    });

    it.each(REMOTE_TRACKING_DESTINATION)('should refuse a refspec that writes under refs/remotes/, for any remote: %s', async (command) => {
      await refused(command);
    });

    it.each(SYMBOLIC_REF_WRITES)('should refuse a symbolic-ref write under refs/remotes/: %s', async (command) => {
      await refused(command);
    });

    it.each(LOCAL_REMOTE_URLS())('should refuse a remote pointed at a local path or file:// URL: %s', async (command) => {
      await refused(command);
    });

    it.each(MORE_ROUTES)('should refuse a local insteadOf base, a forged fetch mapping or a mirror remote: %s', async (command) => {
      await refused(command);
    });

    it.each(ALLOWED)('should still allow everyday fetch, pull, push, symbolic-ref and remotes on real hosts: %s', async (command) => {
      const result = await call(command, agent, platform);
      expect(result.stderr, command).toBe('');
      expect(result.exitCode, command).toBe(0);
    });
  });
});

describe('remote-tracking refs (gate-gaps-r3 Task 7): the refusal does not repeat the value it was given', () => {
  it.each([
    'git fetch origin main:refs/remotes/VALUE-7f3/x',
    'git push origin HEAD:refs/remotes/origin/VALUE-7f3',
    'git fetch ./VALUE-7f3/.. HEAD:refs/heads/y',
    'git symbolic-ref refs/remotes/VALUE-7f3/HEAD refs/remotes/origin/x',
    'git remote add VALUE-7f3 /tmp/VALUE-7f3',
    'git remote set-url origin /tmp/VALUE-7f3',
    'git -c remote.origin.url=/tmp/VALUE-7f3 fetch',
  ])('should refuse without echoing the value: %s', async (command) => {
    const result = await call(command, null, 'linux');
    expect(result.exitCode, command).toBe(2);
    expect(result.stderr, command).not.toContain('VALUE-7f3');
  });
});
