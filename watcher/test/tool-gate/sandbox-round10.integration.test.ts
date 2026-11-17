/**
 * @behavior Round 10 (part A) review sandbox fixes, run for real through sandbox-exec (macOS):
 *   - D-R10-2 / SEC LOW-4: each review agent gets its own private folder
 *     `<T>/oss-review/<session>/<agent id>`, its TMPDIR and caches; it can't write another agent's.
 *   - D-R10-1: Claude Code's session transcripts (`<temp>/claude-*\/**\/tasks/**`) can't be read;
 *     the files beside them can. Reads through `/System/Volumes/Data` and `/.vol` stay denied.
 *   - SEC MEDIUM-2: the clipboard can't be read.
 *   - SEC LOW-3: the call can't listen on OSS's own ports, and a job it leaves running ends with it
 *     (a child that starts its own session is a known limit).
 *   - SEC MEDIUM-3 / PEN LOW-1: Claude Code's sandbox mode is read only from the user's own and the
 *     managed settings, never from the project's.
 *   - CR MEDIUM-3: the new toolchain folders are readable (temp-HOME probe in sandbox.integration;
 *     a real probe of the ones on this Mac here).
 * @business-rule R-266: a review agent may not change what it judges, nor read beyond what it reviews.
 * @boundary /usr/bin/sandbox-exec, run for real through the command the gate builds, against a temp
 *   home and a temp "user temp folder". The clipboard and the real home are only probed with hashes
 *   and yes/no answers; nothing secret is printed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { reviewContainment, reviewSandboxProfile, SANDBOX_EXEC, type Containment } from '../../src/tool-gate/sandbox.js';

const ON_MAC = process.platform === 'darwin';
const REAL_HOME = os.userInfo().homedir;
const SESSION = 'sbx-r10';

let root: string;
let home: string;
let repo: string;
let userTemp: string;
let tmpdir: string;
let transcripts: string;

function containment(overrides: Partial<Parameters<typeof reviewContainment>[0]> = {}): Containment {
  return reviewContainment({
    platform: 'darwin',
    home,
    sessionId: SESSION,
    agentId: 'agent-a',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home },
    toolInput: {},
    disabled: false,
    userTemp,
    tmpdir,
    // round 11, CR LOW-A: never the user's own Claude Code settings
    settingsHomes: [home],
    ...overrides,
  });
}

function sandboxed(c: Containment): Extract<Containment, { kind: 'sandbox' }> {
  if (c.kind !== 'sandbox') throw new Error(`expected the sandbox, got ${c.kind}`);
  return c;
}

function run(c: Containment, command: string): { status: number | null; out: string } {
  const wrapped = sandboxed(c).wrap(command, [repo]);
  expect(String(wrapped).startsWith(`${SANDBOX_EXEC} `)).toBe(true);
  const ran = spawnSync('/bin/bash', ['-c', String(wrapped)], { cwd: repo, encoding: 'utf8', timeout: 60_000, env: { PATH: '/usr/bin:/bin' } });
  return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
}

const yesNo = (p: string): string => `{ cat '${p}'; } >/dev/null 2>&1 && echo yes || echo no`;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.runIf(ON_MAC)('round 10: the review sandbox for real (macOS)', () => {
  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-sbx10-')));
    home = path.join(root, 'home');
    repo = path.join(home, 'dev', 'repo');
    userTemp = path.join(root, 'T');
    tmpdir = path.join(root, 'tmpdir');
    for (const dir of [repo, tmpdir]) fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(userTemp, { mode: 0o700 });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    fs.writeFileSync(path.join(home, 'notes.txt'), 'private\n');
    // a transcript folder in /private/tmp, as Claude Code lays it out, and one in the session TMPDIR
    transcripts = `/private/tmp/claude-oss-r10-${process.pid}`;
    for (const base of [transcripts, path.join(tmpdir, 'claude-501')]) {
      fs.mkdirSync(path.join(base, '-Users-x', 'sess', 'tasks'), { recursive: true });
      fs.mkdirSync(path.join(base, '-Users-x', 'sess', 'scratchpad'), { recursive: true });
      fs.writeFileSync(path.join(base, '-Users-x', 'sess', 'tasks', 'b1.output'), 'transcript\n');
      fs.writeFileSync(path.join(base, '-Users-x', 'sess', 'scratchpad', 'n.md'), 'notes\n');
    }
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(transcripts, { recursive: true, force: true });
  });

  describe('D-R10-2: a private folder per agent', () => {
    it("makes <T>/oss-review/<session>/<agent id> (0700), points TMPDIR at it, and denies another agent's folder and the session folder", () => {
      const own = path.join(userTemp, 'oss-review', SESSION, 'agent-a');
      const c = containment();
      expect(run(c, 'printf "%s" "$TMPDIR"').out).toBe(own);
      expect(fs.lstatSync(own).mode & 0o777).toBe(0o700);
      expect(fs.lstatSync(path.dirname(own)).mode & 0o777).toBe(0o700);
      expect(run(c, 'echo ok > "$TMPDIR/w.txt" && cat "$TMPDIR/w.txt"').out).toBe('ok\n');
      containment({ agentId: 'agent-b' });
      for (const target of [path.join(userTemp, 'oss-review', SESSION, 'agent-b', 'x.txt'), path.join(userTemp, 'oss-review', SESSION, 'x.txt')]) {
        expect(run(c, `echo x > '${target}'`).status, target).not.toBe(0);
        expect(fs.existsSync(target), target).toBe(false);
      }
    });

    it('falls back to the session folder when the agent id is missing or unsafe', () => {
      for (const agentId of [undefined, '../x', 'a b']) {
        expect(run(containment({ agentId }), 'printf "%s" "$TMPDIR"').out, String(agentId)).toBe(path.join(userTemp, 'oss-review', SESSION));
      }
    });
  });

  describe('D-R10-1: transcripts and other paths', () => {
    it("denies Claude Code's session transcripts in /private/tmp and the session TMPDIR, and allows the files beside them", () => {
      const c = containment();
      for (const base of [transcripts, path.join(tmpdir, 'claude-501')]) {
        expect(run(c, yesNo(path.join(base, '-Users-x', 'sess', 'tasks', 'b1.output'))).out, base).toBe('no\n');
        expect(run(c, `ls '${path.join(base, '-Users-x', 'sess', 'tasks')}' >/dev/null 2>&1 && echo yes || echo no`).out, base).toBe('no\n');
        expect(run(c, yesNo(path.join(base, '-Users-x', 'sess', 'scratchpad', 'n.md'))).out, base).toBe('yes\n');
      }
      expect(run(c, yesNo(`/tmp/claude-oss-r10-${process.pid}/-Users-x/sess/tasks/b1.output`)).out).toBe('no\n');
    });

    it('denies the home folder through the /System/Volumes/Data firmlink and /.vol', () => {
      const c = containment();
      const notes = path.join(home, 'notes.txt');
      expect(run(c, yesNo(`/System/Volumes/Data${notes}`)).out).toBe('no\n');
      const stat = fs.statSync(notes);
      expect(run(c, yesNo(`/.vol/${stat.dev}/${stat.ino}`)).out).toBe('no\n');
    });
  });

  describe('SEC MEDIUM-2: the clipboard', () => {
    it('reads nothing from the clipboard (hashes compared, never shown)', () => {
      const empty = spawnSync('/usr/bin/shasum', { input: '', encoding: 'utf8' }).stdout;
      const inside = run(containment(), '/usr/bin/pbpaste 2>/dev/null | /usr/bin/shasum').out;
      expect(inside).toBe(empty);
      expect(reviewSandboxProfile({ homes: [home], privateDir: userTemp, repos: [] })).toContain('(deny mach-lookup (global-name-prefix "com.apple.pasteboard"))');
    });
  });

  describe("SEC LOW-3: OSS's own ports and jobs left running", () => {
    const bind = (port: number): string => `/usr/bin/python3 -c 'import socket,errno
s=socket.socket()
try:
  s.bind(("127.0.0.1",${port})); print("bound")
except PermissionError: print("denied")
except OSError as e: print("in use" if e.errno==errno.EADDRINUSE else "other")' 2>/dev/null`;

    async function freePort(): Promise<number> {
      const server = net.createServer();
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as net.AddressInfo;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return port;
    }

    it('may not listen on 8473 by default, nor on the configured proxy port; other ports still work', async () => {
      const port = await freePort();
      expect(run(containment(), bind(8473)).out).toBe('denied\n');
      const configured = containment({ ports: [8473, port] });
      expect(run(configured, bind(port)).out).toBe('denied\n');
      expect(run(containment(), bind(port)).out).toBe('bound\n');
    });

    // round 11, CR INFO-4: every process these tests start carries this marker in its command line,
    // is killed by it afterwards, and none is left (pgrep by the marker)
    const MARKER = `oss-r10-orphan-${process.pid}`;
    const left = (): string => spawnSync('/usr/bin/pgrep', ['-f', MARKER], { encoding: 'utf8' }).stdout.trim();
    afterAll(() => {
      spawnSync('/usr/bin/pkill', ['-KILL', '-f', MARKER]);
      spawnSync('/bin/sleep', ['0.2']);
      expect(left()).toBe('');
    });

    it('ends a job the call leaves running when the call ends', () => {
      const c = containment();
      const out = run(c, `(exec -a ${MARKER} /bin/sleep 300) >/dev/null 2>&1 & echo $!; exit 3`);
      expect(out.status).toBe(3);
      const pid = Number(out.out.trim());
      expect(pid).toBeGreaterThan(0);
      const until = Date.now() + 5000;
      while (left() !== '' && Date.now() < until) spawnSync('/bin/sleep', ['0.1']);
      expect(left()).toBe('');
    });

    it('known limit: a child that starts its own session (setsid) is not ended', () => {
      const c = containment();
      const out = run(c, `/usr/bin/perl -e 'use POSIX; my $p = fork(); if ($p == 0) { POSIX::setsid(); open(STDOUT, ">/dev/null"); open(STDERR, ">/dev/null"); exec { "/bin/sleep" } "${MARKER}", "300"; exit 0 } print "$p\\n"'`);
      const pid = Number(out.out.trim());
      try {
        expect(pid).toBeGreaterThan(0);
        spawnSync('/bin/sleep', ['0.3']);
        expect(alive(pid)).toBe(true);
        expect(left()).not.toBe('');
      } finally {
        if (pid > 0) process.kill(pid, 'SIGKILL');
      }
    });
  });

  describe("SEC MEDIUM-3 / PEN LOW-1: Claude Code's sandbox mode", () => {
    function settings(file: string, enabled: boolean): void {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ sandbox: { enabled } }));
    }

    it("ignores the project's own .claude settings", () => {
      settings(path.join(repo, '.claude', 'settings.json'), true);
      settings(path.join(repo, '.claude', 'settings.local.json'), true);
      try {
        expect(containment().kind).toBe('sandbox');
      } finally {
        fs.rmSync(path.join(repo, '.claude'), { recursive: true, force: true });
      }
    });

    it("reads the user's own settings.json and settings.local.json", () => {
      for (const name of ['settings.json', 'settings.local.json']) {
        const file = path.join(home, '.claude', name);
        settings(file, true);
        try {
          expect(containment()).toEqual({ kind: 'fallback', why: 'host-sandbox' });
        } finally {
          fs.rmSync(file);
        }
      }
    });
  });

  describe('CR MEDIUM-3: toolchain folders present on this Mac', () => {
    it('lists each new toolchain folder that exists in the real home (yes/no only)', () => {
      const c = containment();
      for (const rel of ['Library/Python', '.gem', 'Library/Caches/pypoetry/virtualenvs', '.local/pipx', '.local/share/mise', '.rvm', '.local/share/fnm', 'Library/Application Support/fnm', '.yarn/berry']) {
        const at = path.join(REAL_HOME, rel);
        if (!fs.existsSync(at)) continue;
        expect(run(c, `ls '${at}' >/dev/null 2>&1 && echo yes || echo no`).out, rel).toBe('yes\n');
      }
      expect(run(c, `ls '${path.join(REAL_HOME, 'Library/Application Support')}' >/dev/null 2>&1 && echo yes || echo no`).out).toBe('no\n');
    });
  });
});
