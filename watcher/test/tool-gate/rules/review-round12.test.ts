/**
 * @behavior Round 12 (part A) fixes for review agents' Read/Grep/Glob and Bash calls:
 *   - D-R12-2 / PERF MEDIUM-1: a repo with a huge ignored build folder is reviewed without delay
 *     (the nested-repo check never lists ignored files; round 13, D-R13-1: nothing is cached); a git timeout
 *     there gets its own refusal text. A clone inside an ignored folder stays readable (accepted).
 *   - SEC INFO-A: a Grep or Glob rooted in the reviewer's private folder is refused when a link is
 *     anywhere under it, or when there are too many entries to check.
 *   - SEC CRITICAL-A backstop: after a review agent's Bash call, a file system mounted under a
 *     reviewed repo or its private folder voids the review (tamper mark) and is refused.
 *   - PERF INFO-1: a `tasks` folder inside a reviewed repo under /private/tmp/claude-* is not taken
 *     for Claude Code's transcript folder.
 * @business-rule R-266: a review agent may read what it reviews, nothing beyond it, without delay.
 * @boundary runToolGate (gate.ts) with review-agent hook inputs. HOME is the test run's own temp
 *   home (test/setup.ts); git is real, counted through the nestedGit seam (a collaborator).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateDeps, type GateResult } from '../../../src/tool-gate/gate.js';
import { removeInScratchHome } from '../../helpers/scratch-home.js';
import { realGitRun, type GitRun } from '../../../src/tool-gate/nested-repos.js';
import { hasMark } from '../../../src/gate-run/run-store.js';

const ON_MAC = process.platform === 'darwin';
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const HOME = process.env.HOME ?? '';
const REVIEWER = 'oss:code-reviewer';
const SESSION = `r12-${process.pid}`;
const AGENT_ID = 'agent-r12';
let root: string;
let userTemp: string;

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, stdio: 'ignore' });
};

function gate(cwd: string, tool: string, input: Record<string, unknown>, opts: { sandbox?: 'off' | 'real'; nestedGit?: GitRun } = {}): Promise<GateResult> {
  const deps: GateDeps = { platform: 'darwin', sandbox: { userTemp, settingsHomes: [HOME] }, ...(opts.nestedGit === undefined ? {} : { nestedGit: opts.nestedGit }) };
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({ session_id: SESSION, cwd, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, agent_type: REVIEWER, agent_id: AGENT_ID }),
      env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: cwd, TMPDIR: os.tmpdir(), ...((opts.sandbox ?? 'off') === 'off' ? { OSS_TOOL_GATE_SANDBOX: 'off' } : {}) },
      hookEnv: { PATH: '/usr/bin:/bin', HOME },
      bundleRoot: PLUGIN_ROOT,
    },
    deps,
  );
}

beforeAll(() => {
  if (!path.basename(HOME).startsWith('oss-test-home-')) throw new Error("expected the test run's temp HOME");
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r12-')));
  userTemp = path.join(root, 'T');
  fs.mkdirSync(userTemp, { mode: 0o700 });
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  // Only ever inside the test run's temp HOME: if setup failed and HOME is the real home, this throws and deletes nothing.
  removeInScratchHome(HOME, 'dev');
  removeInScratchHome(HOME, '.oss');
});

describe('D-R12-2 / PERF MEDIUM-1: a repo with ~100k ignored files', () => {
  let repo: string;
  let calls = 0;
  let bytes = 0;
  const counted: GitRun = async (args, cwd, keep, limitMs) => {
    calls += 1;
    const out = await realGitRun(args, cwd, keep, limitMs);
    bytes += out.stdout.length;
    return out;
  };

  beforeAll(() => {
    repo = path.join(HOME, 'dev', 'big');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, '.gitignore'), 'build/\n');
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'a\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'a');
    for (let d = 0; d < 100; d += 1) {
      const dir = path.join(repo, 'build', `d${d}`);
      fs.mkdirSync(dir, { recursive: true });
      for (let f = 0; f < 1000; f += 1) fs.writeFileSync(path.join(dir, `f${f}.o`), '');
    }
    // a clone in the ignored folder (accepted limit) and one in an untracked plain folder
    for (const name of ['build/clone', 'plain/deep/other']) {
      fs.mkdirSync(path.join(repo, name), { recursive: true });
      git(path.join(repo, name), 'init', '-q', '-b', 'main');
      fs.writeFileSync(path.join(repo, name, 'secret.txt'), 'theirs\n');
    }
  }, 120_000);

  it('lets a review Read through, with a couple of small git calls each time (round 13, D-R13-1: nothing cached)', async () => {
    calls = 0;
    bytes = 0;
    const first = await gate(repo, 'Read', { file_path: path.join(repo, 'src', 'a.ts') }, { nestedGit: counted });
    expect(first.exitCode, first.stderr).toBe(0);
    expect(calls).toBeLessThanOrEqual(2);
    expect(bytes).toBeLessThan(20_000);
    calls = 0;
    const second = await gate(repo, 'Read', { file_path: path.join(repo, 'src', 'a.ts') }, { nestedGit: counted });
    expect(second.exitCode, second.stderr).toBe(0);
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(2);
    // no answer is kept on disk for a later call to trust (SEC LOW, round 12)
    const runDir = path.join(HOME, '.oss', 'run');
    const kept = fs.existsSync(runDir) ? (fs.readdirSync(runDir, { recursive: true }) as string[]).filter((name) => path.basename(name).startsWith('nested-')) : [];
    expect(kept).toEqual([]);
  });

  it.runIf(ON_MAC)('lets a review Bash call through, wrapped in the sandbox', async () => {
    const result = await gate(repo, 'Bash', { command: 'ls src' }, { sandbox: 'real', nestedGit: counted });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('/usr/bin/sandbox-exec');
  });

  it('still refuses a repo deep in an untracked folder; a clone in the ignored folder stays readable (accepted limit)', async () => {
    expect((await gate(repo, 'Read', { file_path: path.join(repo, 'plain/deep/other/secret.txt') })).exitCode).toBe(2);
    expect((await gate(repo, 'Read', { file_path: path.join(repo, 'build/clone/secret.txt') })).exitCode).toBe(0);
  });

  it('a git timeout gets its own refusal text', async () => {
    const timedOut: GitRun = () => ({ status: null, stdout: '', timedOut: true });
    const fresh = path.join(HOME, 'dev', 'fresh');
    fs.mkdirSync(fresh, { recursive: true });
    git(fresh, 'init', '-q', '-b', 'main');
    const result = await gate(fresh, 'Read', { file_path: path.join(fresh, 'x.ts') }, { nestedGit: timedOut });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('the nested-repo check timed out');
    expect(result.stderr).not.toContain("git can't tell");
  });
});

describe('SEC INFO-A: a search in the private folder with a link under it', () => {
  let repo: string;
  let own: string;

  beforeAll(async () => {
    repo = path.join(HOME, 'dev', 'repo-a');
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    own = path.join(userTemp, 'oss-review', SESSION, AGENT_ID);
    // the gate makes the private folder on a review agent's Write
    await gate(repo, 'Write', { file_path: path.join(own, 'seed.md'), content: 'x' });
    fs.mkdirSync(path.join(own, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(own, 'a', 'b', 'n.md'), 'n');
  });

  it('allows Grep and Glob of the private folder with no link under it', async () => {
    expect((await gate(repo, 'Grep', { pattern: 'x', path: own })).exitCode).toBe(0);
    expect((await gate(repo, 'Glob', { pattern: '**/*.md', path: own })).exitCode).toBe(0);
  });

  it('refuses Grep and Glob of the private folder when a link is deep under it', async () => {
    fs.symlinkSync(path.join(HOME, '.ssh'), path.join(own, 'a', 'b', 'l'));
    try {
      expect((await gate(repo, 'Grep', { pattern: 'x', path: own })).exitCode).toBe(2);
      expect((await gate(repo, 'Glob', { pattern: '**/*', path: own })).exitCode).toBe(2);
      expect((await gate(repo, 'Grep', { pattern: 'x', path: path.join(own, 'a') })).exitCode).toBe(2);
    } finally {
      fs.unlinkSync(path.join(own, 'a', 'b', 'l'));
    }
  });

  it('refuses when there are too many entries under it to check', async () => {
    const many = path.join(own, 'many');
    fs.mkdirSync(many);
    for (let i = 0; i < 6000; i += 1) fs.writeFileSync(path.join(many, `f${i}`), '');
    try {
      const result = await gate(repo, 'Grep', { pattern: 'x', path: own });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('too many');
    } finally {
      fs.rmSync(many, { recursive: true, force: true });
    }
  });
});

describe('PERF INFO-1: a `tasks` folder in a reviewed repo under /private/tmp/claude-*', () => {
  const tmpRoot = `/private/tmp/claude-oss-r12-${process.pid}`;
  const tmpRepo = path.join(tmpRoot, '-Users-x', 'sess', 'scratchpad', 'repo');

  beforeAll(() => {
    fs.mkdirSync(path.join(tmpRepo, 'src', 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(tmpRepo, 'src', 'tasks', 'b.ts'), 'b\n');
    fs.mkdirSync(path.join(tmpRoot, '-Users-x', 'sess', 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, '-Users-x', 'sess', 'tasks', 'b1.output'), 't\n');
    git(tmpRepo, 'init', '-q', '-b', 'main');
  });
  afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  it('allows Read and Grep of repo/src/tasks', async () => {
    expect((await gate(tmpRepo, 'Read', { file_path: path.join(tmpRepo, 'src', 'tasks', 'b.ts') })).exitCode).toBe(0);
    expect((await gate(tmpRepo, 'Grep', { pattern: 'x', path: path.join(tmpRepo, 'src', 'tasks') })).exitCode).toBe(0);
  });

  it("still refuses the session's own transcript folder", async () => {
    expect((await gate(tmpRepo, 'Read', { file_path: path.join(tmpRoot, '-Users-x', 'sess', 'tasks', 'b1.output') })).exitCode).toBe(2);
  });
});

/** Unmounts every mount whose line holds the marker, then detaches every device attached from `image`. */
function detachAll(marker: string, image: string): void {
  const table = (): string[] => spawnSync('/sbin/mount', [], { encoding: 'utf8' }).stdout.split('\n').filter((line) => line.includes(marker));
  for (let round = 0; round < 3 && table().length > 0; round += 1) {
    for (const line of table()) {
      const at = / on (.+) \(/.exec(line)?.[1];
      const dev = line.split(' ')[0];
      if (at !== undefined) spawnSync('/sbin/umount', ['-f', at], { stdio: 'ignore', timeout: 30_000 });
      if (dev !== undefined) spawnSync('/usr/bin/hdiutil', ['detach', '-force', dev], { stdio: 'ignore', timeout: 30_000 });
    }
  }
  // devices attached from the image but not mounted
  let current = '';
  for (const line of spawnSync('/usr/bin/hdiutil', ['info'], { encoding: 'utf8' }).stdout.split('\n')) {
    const img = /^image-path\s*:\s*(.+)$/.exec(line)?.[1];
    if (img !== undefined) current = img;
    const dev = /^(\/dev\/disk\d+)\s/.exec(line)?.[1];
    if (dev !== undefined && current === image) spawnSync('/usr/bin/hdiutil', ['detach', '-force', dev], { stdio: 'ignore', timeout: 30_000 });
  }
}

describe.runIf(ON_MAC)('SEC CRITICAL-A backstop: a mount under the reviewed repo after a review call', () => {
  const MARKER = `oss-r12-post-${process.pid}`;
  let repo: string;
  let image: string;
  const mounts = (): string[] => execFileSync('/sbin/mount', [], { encoding: 'utf8' }).split('\n').filter((line) => line.includes(MARKER));
  const post = (cwd: string): Promise<GateResult> =>
    runToolGate(
      {
        mode: 'post',
        input: JSON.stringify({ session_id: SESSION, cwd, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: '' }, agent_type: REVIEWER, agent_id: AGENT_ID }),
        env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: cwd, TMPDIR: os.tmpdir() },
        hookEnv: { PATH: '/usr/bin:/bin', HOME },
        bundleRoot: PLUGIN_ROOT,
      },
      { platform: 'darwin', sandbox: { userTemp, settingsHomes: [HOME] } },
    );

  beforeAll(() => {
    repo = path.join(HOME, 'dev', MARKER);
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    image = path.join(root, 'post.dmg');
    execFileSync('/usr/bin/hdiutil', ['create', '-quiet', '-size', '1m', '-fs', 'HFS+', '-volname', 'ossr12post', '-layout', 'NONE', image], { timeout: 60_000 });
  }, 120_000);

  afterAll(() => {
    detachAll(MARKER, image);
    expect(mounts()).toEqual([]);
  });

  it('nothing mounted: the post call passes and the review is not voided', async () => {
    // round 13, D-R13-2: the agent's first pre call records its mount baseline
    const pre = await runToolGate(
      {
        mode: 'pre',
        input: JSON.stringify({ session_id: SESSION, cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(repo, 'x') }, agent_type: REVIEWER, agent_id: AGENT_ID }),
        env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
        hookEnv: { PATH: '/usr/bin:/bin', HOME },
        bundleRoot: PLUGIN_ROOT,
      },
      { platform: 'darwin', sandbox: { userTemp, settingsHomes: [HOME] } },
    );
    expect(pre.exitCode, pre.stderr).toBe(0);
    expect((await post(repo)).exitCode).toBe(0);
    expect(hasMark(HOME, SESSION, AGENT_ID, 'tamper')).toBe(false);
  });

  it('a disk image mounted over .git/hooks: refused, and the review is voided', async () => {
    // mounted outside any sandbox, as if a review call had got past the deny rule
    execFileSync('/usr/bin/hdiutil', ['attach', '-quiet', '-nobrowse', '-readonly', '-mountpoint', path.join(repo, '.git', 'hooks'), image], { timeout: 60_000 });
    expect(mounts().length).toBe(1);
    const result = await post(repo);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('mounted');
    expect(hasMark(HOME, SESSION, AGENT_ID, 'tamper')).toBe(true);
  });
});
