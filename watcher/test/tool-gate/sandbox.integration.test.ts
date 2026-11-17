/**
 * @behavior A review agent's Bash call runs inside an allowlist sandbox on macOS: it may write only
 *   its own private session folder (and /dev/null, ttys, fds), may reach no Unix socket but the DNS
 *   one, may read nothing under the home folder except the reviewed repo and the toolchain folders,
 *   never the credential stores, and starts with a clean environment holding only non-secret names.
 *   The usual review commands (git, rg, vitest, npm test, pytest, ruff, go test, cargo test, curl)
 *   still work inside it. When the sandbox can't be trusted (a repo or HOME inside the private folder,
 *   a planted private folder, a failed self-test) the call is refused, never run unsandboxed.
 * @business-rule R-266 round 9, D-R9-1: an allowlist profile, because rounds 7 and 8 showed a
 *   deny-list never converges; network on, credentials off.
 * @boundary /usr/bin/sandbox-exec, run for real through the command the gate builds (macOS only),
 *   against a temp home with planted fake credentials, a repo under it and a temp "user temp folder".
 *   The user's real home is only probed with yes/no answers.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheEnv, reviewContainment, reviewSandboxProfile, SANDBOX_EXEC, TOOLCHAIN_PLACES, type Containment } from '../../src/tool-gate/sandbox.js';

const ON_MAC = process.platform === 'darwin';
const WATCHER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PREF_DOMAIN = `com.oss.sandbox-test-${process.pid}`;
const REAL_HOME = os.userInfo().homedir;

let root: string;
let home: string;
let repo: string;
let userTemp: string;
let sandbox: Extract<Containment, { kind: 'sandbox' }>;
let privateDir: string;

function has(tool: string): boolean {
  return spawnSync('/bin/bash', ['-c', `command -v ${tool}`], { env: { PATH: process.env.PATH ?? '' } }).status === 0;
}

/** The hook's environment the sandbox copies names from: secrets included, to prove they stay out. */
function hookEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: home,
    USER: os.userInfo().username,
    LANG: 'en_US.UTF-8',
    LC_CTYPE: 'en_US.UTF-8',
    CARGO_HOME: path.join(REAL_HOME, '.cargo'),
    RUSTUP_HOME: path.join(REAL_HOME, '.rustup'),
    GOPATH: path.join(REAL_HOME, 'go'),
    GH_TOKEN: 'fake-token-value',
    MY_API_KEY: 'fake-key-value',
    AWS_SECRET_ACCESS_KEY: 'fake-secret-value',
    CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'fake-session-value',
    NPM_CONFIG_USERCONFIG: '/tmp/x',
    DB_PASSWORD: 'fake-pass-value',
  };
}

function containment(overrides: Partial<Parameters<typeof reviewContainment>[0]> = {}, run?: Parameters<typeof reviewContainment>[1]): Containment {
  return reviewContainment(
    { platform: 'darwin', home, sessionId: 'sbx-test', env: hookEnv(), toolInput: {}, disabled: false, userTemp, settingsHomes: [home], ...overrides },
    run,
  );
}

/** Runs a call the way Claude Code's shell would run the rewritten command. */
function inSandbox(command: string, opts: { cwd?: string; repos?: readonly string[] } = {}): { status: number | null; out: string } {
  const wrapped = sandbox.wrap(command, opts.repos ?? [repo]);
  expect(wrapped).not.toBeNull();
  expect(String(wrapped).startsWith(`${SANDBOX_EXEC} `)).toBe(true);
  const run = spawnSync('/bin/bash', ['-c', String(wrapped)], { cwd: opts.cwd ?? repo, encoding: 'utf8', timeout: 120_000, env: { PATH: '/usr/bin:/bin' } });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

/** inSandbox without blocking the event loop, for a call that talks to a server in this process. */
async function inSandboxAsync(command: string): Promise<{ status: number | null; out: string }> {
  const wrapped = sandbox.wrap(command, [repo]);
  expect(wrapped).not.toBeNull();
  const child = spawn('/bin/bash', ['-c', String(wrapped)], { cwd: repo, env: { PATH: '/usr/bin:/bin' }, timeout: 30_000 });
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
  const status = await new Promise<number | null>((resolve) => child.on('close', resolve));
  return { status, out };
}

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

describe.runIf(ON_MAC)('the allowlist review sandbox on macOS (sandbox-exec, for real)', () => {
  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-sbx-')));
    home = path.join(root, 'home');
    repo = path.join(home, 'dev', 'repo');
    userTemp = path.join(root, 'T');
    fs.mkdirSync(userTemp, { mode: 0o700 });
    for (const rel of ['.ssh/id_test', '.config/gh/hosts.yml', '.netrc', '.oss/config.json', '.oss/config.json.bak', '.claude.json', '.claude/.credentials.json', '.aws/credentials', '.npmrc', '.git-credentials', 'Library/Keychains/login.keychain-db', '.cargo/credentials.toml', '.config/git/credentials', '.docker/config.json', '.kube/config', '.codex/auth.json', '.config/stripe/config.toml']) {
      write(path.join(home, rel), 'FAKE-SECRET-VALUE\n');
    }
    write(path.join(home, 'notes.txt'), 'private notes\n');
    write(path.join(home, '.gitconfig'), '[user]\n\tname = t\n\temail = t@example.invalid\n');
    fs.mkdirSync(path.join(home, 'Library/LaunchAgents'), { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'a.txt'), 'needle\n');
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', '.'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'first'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'a.txt'), 'needle\nchanged\n');
    const made = containment();
    if (made.kind !== 'sandbox') throw new Error(`expected the sandbox, got ${made.kind}`);
    sandbox = made;
    privateDir = path.join(userTemp, 'oss-review', 'sbx-test');
  });

  afterAll(() => {
    spawnSync('defaults', ['delete', PREF_DOMAIN], { stdio: 'ignore' });
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('writes', () => {
    it('makes a private 0700 session folder under the user temp folder and points TMPDIR and the caches at it', () => {
      const stat = fs.lstatSync(privateDir);
      expect(stat.isDirectory()).toBe(true);
      expect(stat.mode & 0o777).toBe(0o700);
      expect(inSandbox('printf "%s\\n" "$TMPDIR" "$npm_config_cache" "$PYTEST_ADDOPTS" "$CLANG_MODULE_CACHE_PATH"').out).toBe(
        `${privateDir}\n${cacheEnv(privateDir).npm_config_cache}\n-p no:cacheprovider\n${cacheEnv(privateDir).CLANG_MODULE_CACHE_PATH}\n`,
      );
    });

    it('allows writes in the private folder and /dev/null only', () => {
      expect(inSandbox('echo ok > "$TMPDIR/w.txt" && cat "$TMPDIR/w.txt" && echo x > /dev/null')).toEqual({ status: 0, out: 'ok\n' });
      const targets = [
        path.join(repo, 'x.txt'),
        path.join(home, 'x.txt'),
        path.join(home, '.oss/x.json'),
        path.join(home, 'Library/LaunchAgents/x.plist'),
        path.join(userTemp, 'beside.txt'),
        path.join(userTemp, 'oss-review', 'other-session.txt'),
        `/private/tmp/oss-sbx-${process.pid}.txt`,
      ];
      for (const target of targets) {
        expect(inSandbox(`echo x > '${target}'`).status, target).not.toBe(0);
        expect(fs.existsSync(target), target).toBe(false);
      }
    });

    it('refuses a write from a job left running after the call ends', async () => {
      const late = path.join(repo, 'late.txt');
      expect(inSandbox(`(sleep 0.5; echo late > '${late}') >/dev/null 2>&1 & disown; exit 0`).status).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(fs.existsSync(late)).toBe(false);
    });

    it('denies renaming a folder that holds a protected path inside a writable root (parent-rename trick)', () => {
      const writable = path.join(root, 'w');
      const inner = path.join(writable, 'a', 'b', 'repo');
      fs.mkdirSync(inner, { recursive: true });
      const profile = reviewSandboxProfile({ homes: [home], privateDir: writable, repos: [inner] });
      const run = spawnSync(SANDBOX_EXEC, ['-p', profile, '/bin/mv', path.join(writable, 'a'), path.join(writable, 'z')], { encoding: 'utf8' });
      expect(run.status).not.toBe(0);
      expect(fs.existsSync(inner)).toBe(true);
      expect(spawnSync(SANDBOX_EXEC, ['-p', profile, '/usr/bin/touch', path.join(writable, 'free.txt')]).status).toBe(0);
    });
  });

  describe('fails closed', () => {
    it('refuses to wrap when a reviewed repo or HOME lies inside the private folder', () => {
      const inside = path.join(privateDir, 'repo');
      fs.mkdirSync(inside, { recursive: true });
      expect(sandbox.wrap('true', [inside])).toBeNull();
      const tempHome = containment({ home: path.join(privateDir, 'h'), env: { ...hookEnv(), HOME: path.join(privateDir, 'h') } });
      expect(tempHome.kind === 'sandbox' ? tempHome.wrap('true', [repo]) : null).toBeNull();
    });

    it('refuses a private folder that is a symlink, and closes one of ours left open', () => {
      const planted = path.join(root, 'T2');
      fs.mkdirSync(path.join(planted), { mode: 0o700 });
      fs.mkdirSync(path.join(root, 'elsewhere'), { recursive: true });
      fs.symlinkSync(path.join(root, 'elsewhere'), path.join(planted, 'oss-review'));
      expect(containment({ userTemp: planted }).kind).toBe('refused');
      const open = path.join(root, 'T3');
      fs.mkdirSync(path.join(open, 'oss-review'), { recursive: true, mode: 0o755 });
      fs.chmodSync(path.join(open, 'oss-review'), 0o755);
      expect(containment({ userTemp: open }).kind).toBe('sandbox');
      expect(fs.lstatSync(path.join(open, 'oss-review')).mode & 0o777).toBe(0o700);
    });

    it('refuses, never falls back, when the self-test fails on macOS without Claude Code sandbox mode', () => {
      const failed = containment({}, () => false);
      expect(failed.kind).toBe('refused');
      expect(failed.kind === 'refused' ? failed.reason : '').toMatch(/sandbox/);
    });
  });

  describe('Unix sockets', () => {
    it('refuses a socket a server opened in /private/tmp and one under the home folder', async () => {
      for (const socket of [`/private/tmp/oss-sbx-${process.pid}.sock`, path.join(home, 'agent.sock')]) {
        const server = net.createServer((c) => c.end('reached\n'));
        await new Promise<void>((resolve) => server.listen(socket, resolve));
        try {
          expect(inSandbox(`/usr/bin/nc -U '${socket}' </dev/null`).out, socket).not.toContain('reached');
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
          fs.rmSync(socket, { force: true });
        }
      }
    });

    // hermetic: no internet. The real-network check is test/live/sandbox-network.live.sh, run by hand.
    it('still reaches a TCP server (curl to a local HTTP server on 127.0.0.1)', async () => {
      const server = http.createServer((_req, res) => res.end('reached\n'));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const { port } = server.address() as net.AddressInfo;
        // async: the server answers from this process, so the call must not block its event loop
        const run = await inSandboxAsync(`/usr/bin/curl -s --max-time 10 http://127.0.0.1:${port}/`);
        expect(run).toEqual({ status: 0, out: 'reached\n' });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("still resolves names through the mDNSResponder socket, and can't without the profile's allow line for it", () => {
      // getaddrinfo for this Mac's own `.local` name is answered by mDNSResponder (no internet needed);
      // `localhost` is not a probe: libinfo answers it from /etc/hosts without asking mDNSResponder
      const own = spawnSync('/usr/sbin/scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).stdout.trim();
      expect(own).toMatch(/^[A-Za-z0-9-]+$/);
      const lookup = `/usr/bin/perl -MSocket=getaddrinfo -e 'my ($e) = getaddrinfo("${own}.local", "80", {socktype => 1}); print $e ? "unresolved\\n" : "resolved\\n"'`;
      expect(inSandbox(lookup).out).toBe('resolved\n');
      const full = reviewSandboxProfile({ homes: [home], privateDir, repos: [repo] });
      const allowLine = full.split('\n').filter((line) => line.includes('mDNSResponder'));
      expect(allowLine).toEqual(['(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))']);
      const withoutDns = full.split('\n').filter((line) => !allowLine.includes(line)).join('\n');
      const run = spawnSync(SANDBOX_EXEC, ['-p', withoutDns, '/bin/bash', '-c', lookup], { encoding: 'utf8', timeout: 20_000 });
      expect(run.stdout).toBe('unresolved\n');
    });
  });

  describe('reads under the home folder', () => {
    it('denies the home folder itself, its other files and every planted credential, even to the repo', () => {
      expect(inSandbox(`ls '${home}' >/dev/null 2>&1 && echo yes || echo no`).out).toBe('no\n');
      expect(inSandbox(`cat '${home}/notes.txt' >/dev/null 2>&1 && echo yes || echo no`).out).toBe('no\n');
      for (const rel of ['.ssh/id_test', '.config/gh/hosts.yml', '.netrc', '.oss/config.json', '.oss/config.json.bak', '.claude.json', '.claude/.credentials.json', '.aws/credentials', '.npmrc', '.git-credentials', 'Library/Keychains/login.keychain-db', '.cargo/credentials.toml', '.config/git/credentials', '.docker/config.json', '.kube/config', '.codex/auth.json', '.config/stripe/config.toml']) {
        const run = inSandbox(`cat '${path.join(home, rel)}'`);
        expect(run.status, rel).not.toBe(0);
        expect(run.out, rel).not.toContain('FAKE-SECRET-VALUE');
      }
    });

    it('allows the reviewed repo and each toolchain folder, read-only', () => {
      expect(inSandbox('cat a.txt').out).toBe('needle\nchanged\n');
      for (const place of TOOLCHAIN_PLACES) {
        const probe = place.kind === 'file' ? path.join(home, place.rel) : path.join(home, place.rel, 'oss-probe.sh');
        if (place.kind === 'folder') write(probe, 'echo ran\n');
        const run = inSandbox(place.kind === 'file' ? `cat '${probe}' >/dev/null && echo ran` : `/bin/bash '${probe}'`);
        expect(run.out, place.rel).toBe('ran\n');
        expect(inSandbox(`echo x >> '${probe}'`).status, place.rel).not.toBe(0);
      }
    });

    it("denies the user's real home (password database) too: its credential stores answer no", () => {
      for (const rel of ['.ssh', '.config/gh', '.aws', 'Library/Keychains', '.claude', '.oss']) {
        const target = path.join(REAL_HOME, rel);
        if (!fs.existsSync(target)) continue;
        expect(inSandbox(`ls '${target}' >/dev/null 2>&1 && echo yes || echo no`).out, rel).toBe('no\n');
      }
      for (const rel of ['.claude.json', '.oss/config.json', '.netrc', '.npmrc', '.git-credentials']) {
        const target = path.join(REAL_HOME, rel);
        if (!fs.existsSync(target)) continue;
        expect(inSandbox(`{ wc -c < '${target}'; } >/dev/null 2>&1 && echo yes || echo no`).out, rel).toBe('no\n');
      }
      expect(inSandbox(`ls '${REAL_HOME}' >/dev/null 2>&1 && echo yes || echo no`).out).toBe('no\n');
    });

    it('git credential fill gives no password and the keychain answers nothing', () => {
      const fill = inSandbox("printf 'protocol=https\\nhost=github.com\\n\\n' | GIT_TERMINAL_PROMPT=0 git credential fill >/dev/null 2>&1; echo done");
      expect(fill.out).toBe('done\n');
      const out = inSandbox("printf 'protocol=https\\nhost=github.com\\n\\n' | GIT_TERMINAL_PROMPT=0 git credential fill 2>/dev/null | grep -c '^password=' || true");
      expect(out.out.trim()).toBe('0');
      expect(inSandbox('security find-generic-password -s oss-sandbox-test >/dev/null 2>&1; echo $?').out).not.toBe('0\n');
    });
  });

  describe('environment', () => {
    it('starts with only the allowlisted, non-secret names', () => {
      const names = inSandbox('env | cut -d= -f1 | sort').out.trim().split('\n');
      for (const secret of ['GH_TOKEN', 'MY_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'CLAUDE_CODE_SESSION_ACCESS_TOKEN', 'NPM_CONFIG_USERCONFIG', 'DB_PASSWORD']) {
        expect(names).not.toContain(secret);
      }
      for (const kept of ['PATH', 'HOME', 'USER', 'LANG', 'LC_CTYPE', 'TMPDIR', 'GOPATH', 'CARGO_HOME', 'npm_config_cache']) expect(names).toContain(kept);
      expect(inSandbox('env').out).not.toMatch(/fake-[a-z]+-value/);
    });
  });

  describe('other limits kept from round 8', () => {
    it('refuses defaults write, open -g and a signal to another process', () => {
      expect(inSandbox(`defaults write ${PREF_DOMAIN} k v`).status).not.toBe(0);
      expect(spawnSync('defaults', ['read', PREF_DOMAIN, 'k']).status).not.toBe(0);
      expect(inSandbox('open -g -j -a Calculator').status).not.toBe(0);
      const other = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
      try {
        expect(inSandbox(`kill ${other.pid}`).status).not.toBe(0);
        expect(() => process.kill(other.pid!, 0)).not.toThrow();
      } finally {
        other.kill();
      }
      expect(inSandbox('sleep 30 & kill $!; wait $!; echo ended').out).toContain('ended');
    });

    it('keeps the call\'s quoting', () => {
      expect(inSandbox(`printf '%s\\n' "it's"`).out).toBe("it's\n");
    });
  });

  describe('the usual review commands still work inside it (throwaway projects under the home folder)', () => {
    function project(name: string, files: Record<string, string>): string {
      const dir = path.join(home, 'dev', name);
      for (const [rel, text] of Object.entries(files)) write(path.join(dir, rel), text);
      return dir;
    }

    it('git status, log and diff; rg and grep', () => {
      // /usr/bin/git's xcrun shim may warn that it can't write its cache in the user temp folder (closed on purpose)
      expect(inSandbox('git status --short')).toMatchObject({ status: 0, out: expect.stringContaining(' M a.txt\n') });
      expect(inSandbox('git log --oneline -1').out).toMatch(/first/);
      expect(inSandbox('git diff --stat').out).toContain('a.txt');
      expect(inSandbox('grep -n needle a.txt').out).toBe('1:needle\n');
      if (has('rg')) expect(inSandbox('rg -l needle .').out).toBe('./a.txt\n');
    }, 180_000);

    it('npx vitest run and npm test', () => {
      const dir = project('js', { 'package.json': '{"name":"p","type":"module","scripts":{"test":"vitest run"}}', 'a.test.js': 'import { it, expect } from "vitest";\nit("a", () => expect(1).toBe(1));\n' });
      fs.symlinkSync(path.join(WATCHER, 'node_modules'), path.join(dir, 'node_modules'));
      for (const command of ['npx --no-install vitest run', 'npm test']) {
        const run = inSandbox(command, { cwd: dir, repos: [dir, WATCHER] });
        expect(run.out, command).toContain('1 passed');
        expect(run.status, command).toBe(0);
      }
    }, 180_000);

    it.runIf(has('pytest'))('pytest with filterwarnings = error (no cache warning from the read-only repo)', () => {
      const dir = project('py', { 'pytest.ini': '[pytest]\nfilterwarnings = error\n', 'test_a.py': 'def test_a():\n    assert 1 == 1\n' });
      const run = inSandbox('pytest -q', { cwd: dir, repos: [dir] });
      expect(run.out).toContain('1 passed');
      expect(run.status).toBe(0);
    }, 180_000);

    it.runIf(has('ruff'))('ruff check', () => {
      const dir = project('ruff', { 'a.py': 'x = 1\n' });
      expect(inSandbox('ruff check .', { cwd: dir, repos: [dir] })).toMatchObject({ status: 0 });
    }, 180_000);

    it.runIf(has('go'))('go test', () => {
      const dir = project('gop', { 'go.mod': 'module example.com/p\n\ngo 1.21\n', 'a_test.go': 'package p\n\nimport "testing"\n\nfunc TestA(t *testing.T) {}\n' });
      const run = inSandbox('go test -count=1 ./...', { cwd: dir, repos: [dir] });
      expect(run.out).toContain('ok');
      expect(run.status).toBe(0);
    }, 180_000);

    it.runIf(has('cargo'))('cargo test --locked', () => {
      const dir = project('rs', { 'Cargo.toml': '[package]\nname = "p"\nversion = "0.1.0"\nedition = "2021"\n', 'src/lib.rs': '#[test]\nfn a() {}\n' });
      execFileSync('cargo', ['generate-lockfile', '--offline', '-q'], { cwd: dir, env: { ...process.env, HOME: REAL_HOME } });
      const run = inSandbox('cargo test --locked -q', { cwd: dir, repos: [dir] });
      expect(run.out).toContain('test result: ok');
      expect(run.status).toBe(0);
    }, 180_000);
  });
});

describe('when the review sandbox is used', () => {
  const base = { home: '/Users/u', sessionId: 's', env: {}, toolInput: {}, disabled: false };

  it('uses the fallback rules on Linux and Windows, or when the session turned it off', () => {
    expect(reviewContainment({ ...base, platform: 'linux' }, () => true).kind).toBe('fallback');
    expect(reviewContainment({ ...base, platform: 'win32', home: 'C:\\Users\\u' }, () => true).kind).toBe('fallback');
    expect(reviewContainment({ ...base, platform: 'darwin', disabled: true }, () => true).kind).toBe('fallback');
  });

  it.runIf(ON_MAC)("uses the fallback rules when Claude Code's own sandbox mode is on (Seatbelt can't nest), unless the call opts out of it", () => {
    const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-sbx-host-')));
    try {
      const h = path.join(top, 'home');
      const proj = path.join(top, 'proj');
      const temp = path.join(top, 'T');
      fs.mkdirSync(temp, { mode: 0o700 });
      // round 10 (SEC MEDIUM-3): only the user's own and the managed settings count, never the project's
      write(path.join(proj, '.claude/settings.local.json'), '{"sandbox":{"enabled":true}}');
      fs.mkdirSync(h);
      const opts = { ...base, platform: 'darwin' as const, home: h, userTemp: temp, settingsHomes: [h] };
      expect(reviewContainment(opts).kind).toBe('sandbox');
      write(path.join(h, '.claude/settings.json'), '{"sandbox":{"enabled":true}}');
      expect(reviewContainment(opts).kind).toBe('fallback');
      expect(reviewContainment({ ...opts, toolInput: { dangerouslyDisableSandbox: true } }).kind).toBe('sandbox');
      write(path.join(h, '.claude/settings.local.json'), '{"sandbox":{"enabled":false}}');
      expect(reviewContainment(opts).kind).toBe('sandbox');
      expect(reviewContainment({ ...opts, env: { SANDBOX_RUNTIME: '1' } }).kind).toBe('fallback');
    } finally {
      fs.rmSync(top, { recursive: true, force: true });
    }
  });
});
