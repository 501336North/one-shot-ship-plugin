/**
 * @behavior Round 11 (part A) fixes for review agents:
 *   - SEC CRITICAL-1: a review agent can't swap a file in its private folder for a link to a secret
 *     between the gate's check and Claude Code's open: no call in the sandbox can make a symlink (also
 *     a child that left the call's process group with setsid or setpgrp), and the Read/Grep/Glob and
 *     Write/Edit checks refuse a private-folder path with a link in it. In the sandbox, `node --test`
 *     runs only test files in the reviewed repos.
 * @business-rule R-266: a review agent may not change what it judges, nor read beyond what it reviews.
 * @boundary runToolGate (gate.ts) with review-agent hook inputs, the wrapped command run for real
 *   through /usr/bin/sandbox-exec (macOS). HOME is the test run's own temp home (test/setup.ts); the
 *   "secret" is a marker file there, never a real credential.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateDeps, type GateResult } from '../../../src/tool-gate/gate.js';
import { removeInScratchHome } from '../../helpers/scratch-home.js';

const ON_MAC = process.platform === 'darwin';
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const HOME = process.env.HOME ?? '';
const REVIEWER = 'oss:code-reviewer';
const SESSION = `r11-${process.pid}`;
const AGENT_ID = 'agent-r11';
const MARKER = `SECRET-MARKER-${process.pid}`;
let root: string;
let repo: string;
let userTemp: string;
let own: string;
let secret: string;

beforeAll(() => {
  if (!path.basename(HOME).startsWith('oss-test-home-')) throw new Error("expected the test run's temp HOME");
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r11-')));
  repo = path.join(HOME, 'dev', 'repo');
  fs.mkdirSync(path.join(repo, 'test'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'test', 'a.test.js'), "require('node:test')('a', () => {});\n");
  secret = path.join(HOME, '.ssh', 'id_marker');
  fs.mkdirSync(path.dirname(secret), { recursive: true });
  fs.writeFileSync(secret, `${MARKER}\n`);
  userTemp = path.join(root, 'T');
  fs.mkdirSync(userTemp, { mode: 0o700 });
  own = path.join(userTemp, 'oss-review', SESSION, AGENT_ID);
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  // Only ever inside the test run's temp HOME: if setup failed and HOME is the real home, this throws and deletes nothing.
  removeInScratchHome(HOME, 'dev');
  removeInScratchHome(HOME, '.ssh');
});

/**
 * The OS mount table is an external collaborator: a fixed, clean table stands in for `/sbin/mount`, so a
 * slow process start (memory pressure) can't refuse a call before the sandbox is even reached. These
 * tests are about the sandbox (still real: sandbox-exec and the real file system); the mount check has
 * its own tests (review-round14a/15a/16a).
 */
const gateDeps = (): GateDeps => ({ platform: 'darwin', sandbox: { userTemp, settingsHomes: [HOME] }, mounts: () => [{ device: '/dev/disk3s1s1', at: '/' }] });

interface CallOptions {
  tool?: string;
  input?: Record<string, unknown>;
  cwd?: string;
  sandbox?: 'off' | 'real';
}

function call(opts: CallOptions): Promise<GateResult> {
  return runToolGate(
    {
      mode: 'pre',
      input: JSON.stringify({
        session_id: SESSION,
        cwd: opts.cwd ?? repo,
        hook_event_name: 'PreToolUse',
        tool_name: opts.tool ?? 'Read',
        tool_input: opts.input ?? {},
        agent_type: REVIEWER,
        agent_id: AGENT_ID,
      }),
      env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir(), ...((opts.sandbox ?? 'off') === 'off' ? { OSS_TOOL_GATE_SANDBOX: 'off' } : {}) },
      hookEnv: { PATH: '/usr/bin:/bin', HOME },
      bundleRoot: PLUGIN_ROOT,
    },
    gateDeps(),
  );
}

const read = (file_path: string): Promise<GateResult> => call({ tool: 'Read', input: { file_path } });
const bash = (command: string, sandbox: 'off' | 'real' = 'real'): Promise<GateResult> => call({ tool: 'Bash', input: { command }, sandbox });

function runWrapped(result: GateResult): { status: number | null; out: string } {
  expect(result.exitCode, result.stderr).toBe(0);
  const parsed = JSON.parse(result.stdout) as { hookSpecificOutput: { updatedInput: { command: string } } };
  const command = parsed.hookSpecificOutput.updatedInput.command;
  expect(command.length).toBeGreaterThan(0);
  expect(command.startsWith('/usr/bin/sandbox-exec ')).toBe(true);
  const ran = spawnSync('/bin/bash', ['-c', command], { cwd: repo, encoding: 'utf8', timeout: 60_000, env: { PATH: '/usr/bin:/bin' } });
  return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitGone(pid: number, ms: number): void {
  const until = Date.now() + ms;
  while (alive(pid) && Date.now() < until) spawnSync('/bin/sleep', ['0.1']);
}

describe.runIf(ON_MAC)('SEC CRITICAL-1: the symlink swap race in the private folder (macOS, real sandbox)', () => {
  /**
   * The exploit: a call writes a plain file in its private folder and leaves a detached child that,
   * a moment later, swaps the file for a link to a secret (rename over it). The gate's Read check
   * sees the plain file; Claude Code's open, after it, would follow the link.
   */
  const swapper = (leave: 'setsid' | 'setpgrp'): string =>
    [
      `printf ok > '${own}/f'`,
      `python3 -c 'import os, sys, time
pid = os.fork()
if pid == 0:
    os.${leave === 'setsid' ? 'setsid()' : 'setpgrp()'}
    fd = os.open("/dev/null", os.O_RDWR)
    for n in (0, 1, 2): os.dup2(fd, n)
    time.sleep(1.5)
    t = sys.argv[2]
    try:
        os.symlink(os.environ["HOME"] + "/.s" + "sh/" + sys.argv[1], t + "/f.l"); os.rename(t + "/f.l", t + "/f")
    except OSError:
        pass
    os._exit(0)
print(pid)' '${path.basename(secret)}' '${own}'`,
    ].join(' && ');

  for (const leave of ['setsid', 'setpgrp'] as const) {
    it(`a detached (${leave}) swapper child can't turn the checked file into a link to a secret`, async () => {
      const ran = runWrapped(await bash(swapper(leave)));
      // The pid is the only all-digit line: macOS's /usr/bin/python3 may also print an xcrun cache
      // warning on stderr inside the sandbox (when the user temp folder's xcrun_db is missing, e.g. after a restart).
      const pid = Number(/^(\d+)$/m.exec(ran.out)?.[1]);
      try {
        expect(ran.status, ran.out).toBe(0);
        expect(pid).toBeGreaterThan(0);
        // the gate's check sees the plain file and allows the Read
        expect((await read(path.join(own, 'f'))).exitCode).toBe(0);
        waitGone(pid, 5000);
        expect(alive(pid)).toBe(false);
        // Claude Code's open, after the check: the plain file, never the secret
        expect(fs.readFileSync(path.join(own, 'f'), 'utf8')).toBe('ok');
        expect(fs.lstatSync(path.join(own, 'f')).isSymbolicLink()).toBe(false);
      } finally {
        if (pid > 0 && alive(pid)) process.kill(pid, 'SIGKILL');
        fs.rmSync(path.join(own, 'f'), { force: true });
        fs.rmSync(path.join(own, 'f.l'), { force: true });
      }
    });
  }

  it('no call in the sandbox can make a symlink: ln -s, symlink() or a link renamed into place', async () => {
    const out = runWrapped(
      await bash(
        [
          `{ ln -s '${own}/seed.md' '${own}/l1' 2>/dev/null && echo made || echo denied; }`,
          `{ python3 -c 'import os, sys; os.symlink("/etc/hosts", sys.argv[1])' '${own}/l2' 2>/dev/null && echo made || echo denied; }`,
        ].join('; '),
      ),
    ).out;
    expect(out).toBe('denied\ndenied\n');
    for (const name of ['l1', 'l2']) expect(fs.lstatSync(path.join(own, name), { throwIfNoEntry: false })).toBeUndefined();
  });

  it("a hard link to a secret can't be made in the private folder, nor read through the gate", async () => {
    const out = runWrapped(await bash(`{ python3 -c 'import os, sys; os.link(os.environ["HOME"] + "/.s" + "sh/" + sys.argv[1], sys.argv[2])' '${path.basename(secret)}' '${own}/hl' 2>/dev/null && echo made || echo denied; }`)).out;
    expect(out).toBe('denied\n');
    expect(fs.lstatSync(path.join(own, 'hl'), { throwIfNoEntry: false })).toBeUndefined();
  });

  it('a call can still write, rename and remove plain files and folders in its private folder', async () => {
    const d = `${own}/d`;
    const out = runWrapped(await bash(`mkdir -p '${d}' && printf a > '${d}/x' && mv '${d}/x' '${d}/y' && cat '${d}/y' && rm -r '${d}' && echo done`)).out;
    expect(out).toBe('adone\n');
  });
});

describe('SEC CRITICAL-1: private-folder paths with a link in them are refused', () => {
  beforeAll(async () => {
    // make the private folder (the gate makes it on a review agent's Write)
    await call({ tool: 'Write', input: { file_path: path.join(own, 'seed.md'), content: 'x' } });
    fs.mkdirSync(path.join(own, 'real'), { recursive: true });
    fs.writeFileSync(path.join(own, 'real', 'n.md'), 'n');
    // links planted inside the private folder that point inside it too (realpath stays in the folder)
    fs.symlinkSync(path.join(own, 'real'), path.join(own, 'dirlink'));
    fs.symlinkSync(path.join(own, 'real', 'n.md'), path.join(own, 'filelink'));
  });

  const refused: [string, () => Promise<GateResult>][] = [
    ['Read through a folder link', () => read(path.join(own, 'dirlink', 'n.md'))],
    ['Read a file link', () => read(path.join(own, 'filelink'))],
    ['Grep through a folder link', () => call({ tool: 'Grep', input: { pattern: 'x', path: path.join(own, 'dirlink') } })],
    ['Glob through a folder link', () => call({ tool: 'Glob', input: { pattern: '*.md', path: path.join(own, 'dirlink') } })],
    ['Write through a folder link', () => call({ tool: 'Write', input: { file_path: path.join(own, 'dirlink', 'w.md'), content: 'x' } })],
    ['Edit a file link', () => call({ tool: 'Edit', input: { file_path: path.join(own, 'filelink'), old_string: 'n', new_string: 'm' } })],
  ];
  for (const [what, run] of refused) {
    it(`refuses: ${what}`, async () => {
      const result = await run();
      expect(result.exitCode, result.stderr).toBe(2);
    });
  }

  it('still allows plain paths in the private folder', async () => {
    expect((await read(path.join(own, 'real', 'n.md'))).exitCode).toBe(0);
    expect((await call({ tool: 'Write', input: { file_path: path.join(own, 'real', 'w.md'), content: 'x' } })).exitCode).toBe(0);
  });
});

describe.runIf(ON_MAC)('SEC CRITICAL-1: in the sandbox, node --test runs only test files in the reviewed repos', () => {
  it('refuses node --test on a file outside the repos (its private folder, /tmp)', async () => {
    for (const command of [`node --test "${own}/t.test.js"`, 'node --test /tmp/x.test.js', 'node --test --test-reporter=spec ../other/a.test.js']) {
      const result = await bash(command);
      expect(result.exitCode, command).toBe(2);
    }
  });

  it("allows node --test on the repo's own tests", async () => {
    for (const command of ['node --test', 'node --test test/a.test.js', `node --test ${repo}/test/a.test.js`]) {
      const result = await bash(command);
      expect(result.exitCode, `${command}: ${result.stderr}`).toBe(0);
    }
  });
});

describe.runIf(ON_MAC)('CR HIGH-A: git works in the sandbox for a worktree and a submodule (macOS, real sandbox)', () => {
  const git = (cwd: string, ...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'protocol.file.allow=always', ...args], { cwd, stdio: 'ignore' });
  };
  const at = (cwd: string, command: string): Promise<GateResult> =>
    runToolGate(
      {
        mode: 'pre',
        input: JSON.stringify({ session_id: SESSION, cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, agent_type: REVIEWER, agent_id: AGENT_ID }),
        env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: cwd, TMPDIR: os.tmpdir() },
        hookEnv: { PATH: '/usr/bin:/bin', HOME },
        bundleRoot: PLUGIN_ROOT,
      },
      gateDeps(),
    );
  const runIn = (result: GateResult, cwd: string): { status: number | null; out: string } => {
    expect(result.exitCode, result.stderr).toBe(0);
    const command = (JSON.parse(result.stdout) as { hookSpecificOutput: { updatedInput: { command: string } } }).hookSpecificOutput.updatedInput.command;
    expect(command.startsWith('/usr/bin/sandbox-exec ')).toBe(true);
    const ran = spawnSync('/bin/bash', ['-c', command], { cwd, encoding: 'utf8', timeout: 60_000, env: { PATH: '/usr/bin:/bin' } });
    return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
  };
  let main: string;
  let worktree: string;
  let sub: string;

  beforeAll(() => {
    main = path.join(HOME, 'dev', 'main');
    worktree = path.join(HOME, 'dev', 'main-wt');
    fs.mkdirSync(main, { recursive: true });
    git(main, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(main, 'a.txt'), 'a\n');
    git(main, 'add', 'a.txt');
    git(main, 'commit', '-q', '-m', 'a');
    git(main, 'worktree', 'add', '-q', '-b', 'feat/wt', worktree);
    const lib = path.join(HOME, 'dev', 'lib');
    fs.mkdirSync(lib, { recursive: true });
    git(lib, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(lib, 'l.txt'), 'l\n');
    git(lib, 'add', 'l.txt');
    git(lib, 'commit', '-q', '-m', 'l');
    git(main, 'submodule', 'add', '-q', lib, 'sub');
    sub = path.join(main, 'sub');
  });

  it('git status and git log work in a worktree whose git folder is in the main checkout', async () => {
    const ran = runIn(await at(worktree, 'git status --short && git log --oneline -1 --format=%s'), worktree);
    expect(ran.out).toBe('a\n');
    expect(ran.status).toBe(0);
  });

  it("git status and git log work in a submodule whose git folder is in the superproject's .git/modules", async () => {
    const ran = runIn(await at(sub, 'git status --short && git log --oneline -1 --format=%s'), sub);
    expect(ran.out).toBe('l\n');
    expect(ran.status).toBe(0);
  });

  it("the git folders stay read-only, and the main checkout's own files stay unreadable from the worktree", async () => {
    const ran = runIn(await at(worktree, `{ cat '${path.join(main, 'a.txt')}' >/dev/null 2>&1 && echo leaked || echo denied; }`), worktree);
    expect(ran.out).toBe('denied\n');
  });
});

describe('CR HIGH-A: the git folders go through the readable-roots check', () => {
  it("refuses every read when a repo's .git file points at a git folder that is the home folder", async () => {
    const planted = path.join(HOME, 'dev', 'planted');
    fs.mkdirSync(planted, { recursive: true });
    for (const dir of ['objects', 'refs']) fs.mkdirSync(path.join(HOME, dir), { recursive: true });
    fs.writeFileSync(path.join(HOME, 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(planted, '.git'), `gitdir: ${HOME}\n`);
    try {
      const result = await call({ tool: 'Read', input: { file_path: path.join(planted, 'x.txt') }, cwd: planted });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('home folder');
    } finally {
      for (const p of ['objects', 'refs', 'HEAD']) removeInScratchHome(HOME, p);
      fs.rmSync(planted, { recursive: true, force: true });
    }
  });
});

describe("SEC LOW-3: a review agent can't read another agent's private folder", () => {
  let other: string;
  beforeAll(async () => {
    await call({ tool: 'Write', input: { file_path: path.join(own, 'seed.md'), content: 'x' } });
    fs.writeFileSync(path.join(own, 'seed.md'), 'x\n');
    other = path.join(userTemp, 'oss-review', SESSION, 'agent-other');
    fs.mkdirSync(other, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(other, 'notes.md'), 'theirs\n');
    fs.writeFileSync(path.join(userTemp, 'oss-review', SESSION, 'session.md'), 'session\n');
  });

  const refused: [string, () => Promise<GateResult>][] = [
    ["Read another agent's file", () => read(path.join(userTemp, 'oss-review', SESSION, 'agent-other', 'notes.md'))],
    ['Read a file in the session folder', () => read(path.join(userTemp, 'oss-review', SESSION, 'session.md'))],
    ['Grep the session folder', () => call({ tool: 'Grep', input: { pattern: 'x', path: path.join(userTemp, 'oss-review', SESSION) } })],
    ['Grep the oss-review folder', () => call({ tool: 'Grep', input: { pattern: 'x', path: path.join(userTemp, 'oss-review') } })],
    ['Glob across the agents', () => call({ tool: 'Glob', input: { pattern: `${userTemp}/oss-review/**/*.md` } })],
    ['Grep the user temp folder above them', () => call({ tool: 'Grep', input: { pattern: 'x', path: userTemp } })],
  ];
  for (const [what, run] of refused) {
    it(`refuses: ${what}`, async () => {
      const result = await run();
      expect(result.exitCode, result.stderr).toBe(2);
    });
  }

  it('still reads its own folder', async () => {
    expect((await read(path.join(own, 'seed.md'))).exitCode).toBe(0);
    // a link-free part of it (round 12, SEC INFO-A: the folder itself holds the links planted above)
    fs.mkdirSync(path.join(own, 'plain'), { recursive: true });
    fs.writeFileSync(path.join(own, 'plain', 'p.md'), 'p\n');
    expect((await call({ tool: 'Grep', input: { pattern: 'x', path: path.join(own, 'plain') } })).exitCode).toBe(0);
  });

  it.runIf(ON_MAC)("the sandbox denies reading another agent's folder and the session folder, not its own", async () => {
    const yes = (p: string): string => `{ cat '${p}' >/dev/null 2>&1 && echo yes || echo no; }`;
    const ran = runWrapped(
      await bash([yes(path.join(other, 'notes.md')), yes(path.join(userTemp, 'oss-review', SESSION, 'session.md')), `{ ls '${path.join(userTemp, 'oss-review', SESSION)}' >/dev/null 2>&1 && echo yes || echo no; }`, yes(path.join(own, 'seed.md'))].join('; ')),
    );
    expect(ran.out).toBe('no\nno\nno\nyes\n');
  });
});

describe("SEC LOW-2: a review agent writes only its OWN offload folder's prompt.md", () => {
  const mktempBlock = (): string => {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'agents', 'code-reviewer.md'), 'utf8');
    const block = [...text.matchAll(/^( *)```bash\n([\s\S]*?)^\1```/gm)].map((m) => m[2] ?? '').find((b) => b.includes('mktemp -d -t oss-offload'));
    if (block === undefined) throw new Error('no mktemp block in the agent file');
    return block;
  };
  const post = (agentId: string, stdout: string, command = mktempBlock()): Promise<GateResult> =>
    runToolGate(
      {
        mode: 'post',
        input: JSON.stringify({
          session_id: SESSION,
          cwd: repo,
          hook_event_name: 'PostToolUse',
          tool_name: 'Bash',
          tool_input: { command },
          tool_response: { stdout, stderr: '', interrupted: false },
          agent_type: REVIEWER,
          agent_id: agentId,
        }),
        env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() },
        hookEnv: { PATH: '/usr/bin:/bin', HOME },
        bundleRoot: PLUGIN_ROOT,
      },
      gateDeps(),
    );
  const write = (file_path: string): Promise<GateResult> => call({ tool: 'Write', input: { file_path, content: 'p' } });
  const folders: string[] = [];
  const offloadFolder = (): string => {
    const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-offload.')));
    folders.push(folder);
    return folder;
  };
  afterAll(() => {
    for (const folder of folders) fs.rmSync(folder, { recursive: true, force: true });
    removeInScratchHome(HOME, '.oss', 'run');
  });

  it("refuses prompt.md in an offload folder this agent's own mktemp step did not make (another agent's)", async () => {
    const theirs = offloadFolder();
    expect((await write(path.join(theirs, 'prompt.md'))).exitCode).toBe(2);
    // made by another review agent's own step: still not this one's
    await post('agent-other', `${theirs}/prompt.md\n`);
    expect((await write(path.join(theirs, 'prompt.md'))).exitCode).toBe(2);
  });

  it("allows prompt.md in the folder this agent's own mktemp step printed", async () => {
    const mine = offloadFolder();
    expect((await post(AGENT_ID, `${mine}/prompt.md\n`)).exitCode).toBe(0);
    expect(await write(path.join(mine, 'prompt.md'))).toEqual({ exitCode: 0, stdout: '', stderr: '' });
  });

  it('records nothing from a command that is not its own mktemp step, whatever it printed', async () => {
    const folder = offloadFolder();
    await post(AGENT_ID, `${folder}/prompt.md\n`, `echo '${folder}/prompt.md'`);
    expect((await write(path.join(folder, 'prompt.md'))).exitCode).toBe(2);
  });
});

describe('SEC LOW-1: a readable root does not open the other repos and worktrees inside it', () => {
  let outer: string;
  const git = (cwd: string, ...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, stdio: 'ignore' });
  };
  const at = (tool: string, input: Record<string, unknown>, sandbox: 'off' | 'real' = 'off'): Promise<GateResult> =>
    runToolGate(
      {
        mode: 'pre',
        input: JSON.stringify({ session_id: SESSION, cwd: outer, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, agent_type: REVIEWER, agent_id: AGENT_ID }),
        env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: outer, TMPDIR: os.tmpdir(), ...(sandbox === 'off' ? { OSS_TOOL_GATE_SANDBOX: 'off' } : {}) },
        hookEnv: { PATH: '/usr/bin:/bin', HOME },
        bundleRoot: PLUGIN_ROOT,
      },
      gateDeps(),
    );

  beforeAll(() => {
    // ~/work is itself a repo (everything ignored, as dotfile repos do) holding other projects and a worktree
    outer = path.join(HOME, 'work');
    fs.mkdirSync(outer, { recursive: true });
    git(outer, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(outer, '.gitignore'), 'projects/\n');
    fs.writeFileSync(path.join(outer, 'own.txt'), 'own\n');
    git(outer, 'add', '.');
    git(outer, 'commit', '-q', '-m', 'o');
    for (const name of ['projects/deep/other', 'loose']) {
      const dir = path.join(outer, name);
      fs.mkdirSync(dir, { recursive: true });
      git(dir, 'init', '-q', '-b', 'main');
      fs.writeFileSync(path.join(dir, 'secret.txt'), 'theirs\n');
    }
    git(outer, 'worktree', 'add', '-q', '-b', 'wt', path.join(outer, 'wt'));
  });

  const refused: [string, () => Promise<GateResult>][] = [
    ['Read a file in an untracked nested repo', () => at('Read', { file_path: path.join(outer, 'loose/secret.txt') })],
    ['Read a file in a worktree inside the root', () => at('Read', { file_path: path.join(outer, 'wt/own.txt') })],
    ['Grep the root (it would search the nested repos)', () => at('Grep', { pattern: 'x', path: outer })],
    ['Grep a nested repo', () => at('Grep', { pattern: 'x', path: path.join(outer, 'loose') })],
  ];
  for (const [what, run] of refused) {
    it(`refuses: ${what}`, async () => {
      const result = await run();
      expect(result.exitCode, result.stderr).toBe(2);
    });
  }

  it("still reads the root's own files", async () => {
    expect((await at('Read', { file_path: path.join(outer, 'own.txt') })).exitCode).toBe(0);
  });

  it('accepted limit (round 12, D-R12-2): a repo inside an ignored folder is not looked for, so it stays readable', async () => {
    expect((await at('Read', { file_path: path.join(outer, 'projects/deep/other/secret.txt') })).exitCode).toBe(0);
  });

  it.runIf(ON_MAC)("the sandbox denies the nested repos' and the worktree's files, and git status in the root still works", async () => {
    const result = await at('Bash', { command: `cat own.txt; { cat projects/deep/other/secret.txt >/dev/null 2>&1 && echo leaked || echo denied; }; { cat loose/secret.txt >/dev/null 2>&1 && echo leaked || echo denied; }; { cat wt/own.txt >/dev/null 2>&1 && echo leaked || echo denied; }; git status --short >/dev/null && echo git-ok` }, 'real');
    expect(result.exitCode, result.stderr).toBe(0);
    const command = (JSON.parse(result.stdout) as { hookSpecificOutput: { updatedInput: { command: string } } }).hookSpecificOutput.updatedInput.command;
    expect(command.startsWith('/usr/bin/sandbox-exec ')).toBe(true);
    const ran = spawnSync('/bin/bash', ['-c', command], { cwd: outer, encoding: 'utf8', timeout: 60_000, env: { PATH: '/usr/bin:/bin' } });
    // git warns that it can't open the untracked nested repo's folder, and goes on; the repo in the
    // ignored projects/ folder is readable (round 12, D-R12-2, an accepted limit)
    expect(ran.stdout).toBe('own\nleaked\ndenied\ndenied\ngit-ok\n');
  });
});

describe("CR MEDIUM-A: a refused read of Claude Code's saved outputs names the workaround", () => {
  const WORKAROUND = "page the output with `| sed -n 'START,ENDp'` or write it to $TMPDIR and Read it there";
  for (const file of [path.join(HOME, '.claude/projects/-Users-x/sess/tool-results/b1.txt'), '/private/tmp/claude-501/-Users-x/sess/tasks/b1.output', '/tmp/claude-501/-Users-x/sess/tasks/b1.output']) {
    it(`refuses ${file.replace(HOME, '~')} and says how to get the output`, async () => {
      const result = await read(file);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(WORKAROUND);
    });
  }

  it('does not add it to other refusals', async () => {
    expect((await read(path.join(HOME, '.zsh_history'))).stderr).not.toContain(WORKAROUND);
  });
});

describe.runIf(ON_MAC)("CR LOW-A: the homes the sandbox reads settings from and denies are injectable (tests stay off the user's own)", () => {
  it("reads Claude Code's sandbox setting only from the homes it is given", async () => {
    const { reviewContainment } = await import('../../../src/tool-gate/sandbox.js');
    const fake = path.join(root, 'pw-home');
    fs.mkdirSync(path.join(fake, '.claude'), { recursive: true });
    const base = { platform: 'darwin' as const, home: HOME, sessionId: SESSION, agentId: AGENT_ID, env: { PATH: '/usr/bin:/bin' }, toolInput: {}, disabled: false, userTemp };
    fs.writeFileSync(path.join(fake, '.claude', 'settings.json'), JSON.stringify({ sandbox: { enabled: true } }));
    expect(reviewContainment({ ...base, passwordHome: fake, settingsHomes: [fake] })).toEqual({ kind: 'fallback', why: 'host-sandbox' });
    fs.writeFileSync(path.join(fake, '.claude', 'settings.json'), JSON.stringify({ sandbox: { enabled: false } }));
    const c = reviewContainment({ ...base, passwordHome: fake, settingsHomes: [fake] });
    expect(c.kind).toBe('sandbox');
    // the password-database home given is the one the profile denies, not the real one
    const wrapped = c.kind === 'sandbox' ? (c.wrap('true', [repo]) ?? '') : '';
    expect(wrapped).toContain(fake);
    expect(wrapped).not.toContain(`"${os.userInfo().homedir}"`);
  });
});

describe.runIf(ON_MAC)('CR LOW-B: more toolchain folders are readable, read-only (temp-HOME probe)', () => {
  it('runs a script in each of ~/.pub-cache, ~/.virtualenvs, ~/.cabal, ~/.ghcup, ~/.opam and ~/.composer, and writes none', async () => {
    const { reviewContainment } = await import('../../../src/tool-gate/sandbox.js');
    const top = path.join(root, 'lowb');
    const home = path.join(top, 'home');
    const temp = path.join(top, 'T');
    fs.mkdirSync(temp, { recursive: true, mode: 0o700 });
    const rels = ['.pub-cache', '.virtualenvs', '.cabal', '.ghcup', '.opam', '.composer'];
    for (const rel of rels) {
      fs.mkdirSync(path.join(home, rel), { recursive: true });
      fs.writeFileSync(path.join(home, rel, 'probe.sh'), 'echo ran\n');
    }
    fs.writeFileSync(path.join(home, 'other.sh'), 'echo ran\n');
    const c = reviewContainment({ platform: 'darwin', home, passwordHome: home, settingsHomes: [home], sessionId: SESSION, agentId: AGENT_ID, env: { PATH: '/usr/bin:/bin', HOME: home }, toolInput: {}, disabled: false, userTemp: temp });
    const wrapped = (command: string): string => {
      const w = c.kind === 'sandbox' ? (c.wrap(command, [repo]) ?? '') : '';
      expect(w.startsWith('/usr/bin/sandbox-exec ')).toBe(true);
      return w;
    };
    const run = (command: string): string => {
      const ran = spawnSync('/bin/bash', ['-c', wrapped(command)], { cwd: repo, encoding: 'utf8', timeout: 60_000, env: { PATH: '/usr/bin:/bin' } });
      return `${ran.stdout}${ran.stderr}`;
    };
    for (const rel of rels) {
      expect(run(`/bin/bash '${path.join(home, rel, 'probe.sh')}'`), rel).toBe('ran\n');
      expect(run(`{ echo x >> '${path.join(home, rel, 'probe.sh')}'; } 2>/dev/null && echo wrote || echo denied`), rel).toBe('denied\n');
    }
    expect(run(`/bin/bash '${path.join(home, 'other.sh')}' 2>/dev/null || echo denied`)).toBe('denied\n');
    // their credential files stay denied
    for (const rel of ['.pub-cache/credentials.json', '.composer/auth.json', '.cabal/config']) {
      fs.writeFileSync(path.join(home, rel), 'token\n');
      expect(run(`{ cat '${path.join(home, rel)}'; } >/dev/null 2>&1 && echo yes || echo no`), rel).toBe('no\n');
    }
  });
});

describe('SEC INFO-2: with no sandbox, NODE_V8_COVERAGE may name only a temp folder', () => {
  it('refuses coverage written into the repo', async () => {
    for (const command of ['NODE_V8_COVERAGE=cov node --test', `NODE_V8_COVERAGE=${repo}/cov node --test`, 'export NODE_V8_COVERAGE=cov && node --test', 'env NODE_V8_COVERAGE=cov node --test']) {
      const result = await bash(command, 'off');
      expect(result.exitCode, command).toBe(2);
    }
  });

  it('allows coverage written to a temp folder', async () => {
    const result = await bash('NODE_V8_COVERAGE=/tmp/oss-cov node --test', 'off');
    expect(result.exitCode, result.stderr).toBe(0);
  });
});

describe('PERF LOW-3: the joined Glob path and pattern are capped too', () => {
  it('refuses a path and pattern each under the limits whose join is over them', async () => {
    const base = `${repo}/${'a/'.repeat(300)}`;
    const pattern = `${'b/'.repeat(300)}*.ts`;
    const result = await call({ tool: 'Glob', input: { pattern, path: base } });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('512 segments');
  });
});

describe('PERF INFO-2: a reviewed repo inside a /private/tmp/claude-* folder can be searched', () => {
  const tmpRoot = `/private/tmp/claude-oss-r11-${process.pid}`;
  const tmpRepo = path.join(tmpRoot, '-Users-x', 'sess', 'scratchpad', 'repo');
  const at = (tool: string, input: Record<string, unknown>): Promise<GateResult> =>
    runToolGate(
      {
        mode: 'pre',
        input: JSON.stringify({ session_id: SESSION, cwd: tmpRepo, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, agent_type: REVIEWER, agent_id: AGENT_ID }),
        env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: tmpRepo, TMPDIR: os.tmpdir(), OSS_TOOL_GATE_SANDBOX: 'off' },
        hookEnv: { PATH: '/usr/bin:/bin', HOME },
        bundleRoot: PLUGIN_ROOT,
      },
      gateDeps(),
    );
  beforeAll(() => {
    fs.mkdirSync(path.join(tmpRepo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, '-Users-x', 'sess', 'tasks'), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmpRepo });
  });
  afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  it('allows Grep and Glob rooted in the repo', async () => {
    expect((await at('Grep', { pattern: 'x', path: tmpRepo })).exitCode).toBe(0);
    expect((await at('Grep', { pattern: 'x', path: path.join(tmpRepo, 'src') })).exitCode).toBe(0);
    expect((await at('Glob', { pattern: '**/*.ts' })).exitCode).toBe(0);
  });

  it('still refuses a search of the session folder above the repo, or of a transcript folder', async () => {
    expect((await at('Grep', { pattern: 'x', path: path.join(tmpRoot, '-Users-x', 'sess') })).exitCode).toBe(2);
    expect((await at('Grep', { pattern: 'x', path: path.join(tmpRoot, '-Users-x', 'sess', 'tasks') })).exitCode).toBe(2);
  });
});
