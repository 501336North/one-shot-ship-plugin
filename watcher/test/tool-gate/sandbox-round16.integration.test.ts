/**
 * @behavior Round 16 (part A), SEC INFO-1: a review agent's Bash call may write to its controlling
 *   terminal (/dev/tty) and to its own stdout and stderr, but not to the user's other terminals
 *   (/dev/ttys*): typing into another session's terminal could fake output or a prompt there.
 * @business-rule R-266: a review agent writes only to its private folder and its own output.
 * @boundary /usr/bin/sandbox-exec run for real on macOS, through the gate's own wrapping
 *   (reviewContainment). The other terminal is a scratch pseudo-terminal the test opens itself with
 *   /usr/bin/script; its process group is ended in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviewContainment, reviewSandboxProfile, SANDBOX_EXEC, type Containment } from '../../src/tool-gate/sandbox.js';

const ON_MAC = process.platform === 'darwin';
const SESSION = 'sbx-r16';

let root: string;
let home: string;
let repo: string;
let userTemp: string;
let pty: ChildProcess | undefined;
let ptyName = '';

function containment(): Extract<Containment, { kind: 'sandbox' }> {
  const c = reviewContainment({
    platform: 'darwin',
    home,
    sessionId: SESSION,
    agentId: 'agent-a',
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home },
    toolInput: {},
    disabled: false,
    userTemp,
    settingsHomes: [home],
  });
  if (c.kind !== 'sandbox') throw new Error(`expected the sandbox, got ${c.kind}`);
  return c;
}

function sandboxed(command: string): { status: number | null; stdout: string; stderr: string } {
  const wrapped = String(containment().wrap(command, [repo]));
  expect(wrapped.startsWith(`${SANDBOX_EXEC} `)).toBe(true);
  const ran = spawnSync('/bin/bash', ['-c', wrapped], { cwd: repo, encoding: 'utf8', timeout: 60_000, env: { PATH: '/usr/bin:/bin' } });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

describe('SEC INFO-1: the profile allows /dev/tty, not every /dev/tty*', () => {
  it('names /dev/tty exactly and has no /dev/tty prefix rule', () => {
    const profile = reviewSandboxProfile({ homes: ['/Users/x'], privateDir: '/private/var/folders/t/T/oss-review/s/a', repos: [] });
    expect(profile).toContain('(literal "/dev/tty")');
    expect(profile).not.toContain('#"^/dev/tty"');
  });
});

describe.runIf(ON_MAC)('SEC INFO-1: terminals from a review call (macOS, real sandbox)', () => {
  beforeAll(async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r16-tty-')));
    home = path.join(root, 'home');
    repo = path.join(home, 'dev', 'repo');
    userTemp = path.join(root, 'T');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(userTemp, { mode: 0o700 });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    // another terminal of the user's: a scratch pseudo-terminal, outside the sandbox
    const nameFile = path.join(root, 'tty-name');
    pty = spawn('/usr/bin/script', ['-q', '/dev/null', '/bin/sh', '-c', `tty > '${nameFile}'; exec sleep 60`], { detached: true, stdio: 'ignore' });
    for (let i = 0; i < 100 && ptyName === ''; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      ptyName = fs.existsSync(nameFile) ? fs.readFileSync(nameFile, 'utf8').trim() : '';
    }
    if (!/^\/dev\/ttys\d+$/.test(ptyName)) throw new Error('could not open a scratch pseudo-terminal');
  });

  afterAll(() => {
    if (pty?.pid !== undefined) {
      try {
        process.kill(-pty.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("the user's other terminal can be written outside the sandbox (the attack is real)", () => {
    expect(spawnSync('/bin/sh', ['-c', `printf '' > ${ptyName}`]).status).toBe(0);
  });

  it("a write to the user's other terminal is denied", () => {
    const ran = sandboxed(`echo x > ${ptyName} && echo WROTE || echo DENIED`);
    expect(ran.stdout.trim()).toBe('DENIED');
    expect(ran.stderr).toContain('Operation not permitted');
  });

  it('the call still writes its own stdout and stderr, directly and through /dev/stdout and /dev/stderr', () => {
    const ran = sandboxed('echo out; echo err >&2; echo out2 > /dev/stdout; echo err2 > /dev/stderr');
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe('out\nout2\n');
    expect(ran.stderr).toBe('err\nerr2\n');
  });
});
