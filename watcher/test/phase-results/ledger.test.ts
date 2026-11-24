/**
 * Owner-only run ledger (R-257 Task 3b, NOTES "Ledger (D14, T3b)").
 *
 * The ledger is the private record a phase result is bound to. Only the user who owns it
 * may read or write it, a worktree never shares a ledger with its main checkout, and a
 * huge or garbled ledger file can never be mistaken for a valid one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ledgerKey, openLedger, LedgerError } from '../../src/phase-results/ledger.js';

const LEDGER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/phase-results/ledger.ts');

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return env;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, env: gitEnv(), encoding: 'utf8' }).trim();
}

function makeRepo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-repo-')));
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function keyDir(repo: string): string {
  return path.join(os.homedir(), '.oss', 'ledger', ledgerKey(repo) as string);
}

function mode(p: string): number {
  return fs.lstatSync(p).mode & 0o777;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof LedgerError ? e.code : `not-ledger-error: ${String(e)}`;
  }
  return undefined;
}

let repo: string;

beforeEach(() => {
  fs.rmSync(path.join(os.homedir(), '.oss', 'ledger'), { recursive: true, force: true });
  repo = makeRepo();
});

describe('ledger key', () => {
  // User behaviour: hooks written in bash and the TS checker find the same ledger for a repo.
  // Business rule: key = first 16 hex of the git blob id of "<toplevel>\n<absolute-git-dir>\n".
  it('equals the bash git hash-object derivation', () => {
    const top = git(repo, ['rev-parse', '--show-toplevel']);
    const g = git(repo, ['rev-parse', '--absolute-git-dir']);
    const bash = execFileSync('sh', ['-c', `printf '%s\\n%s\\n' "$1" "$2" | git hash-object --stdin | cut -c1-16`, 'sh', top, g], {
      env: gitEnv(),
      encoding: 'utf8',
    }).trim();
    expect(bash).toMatch(/^[0-9a-f]{16}$/);
    expect(ledgerKey(repo)).toBe(bash);
  });

  // User behaviour: a result recorded in a worktree is never accepted in the main checkout.
  // Business rule: a worktree gets its own ledger key.
  it('gives a worktree and its main checkout different keys', () => {
    const wt = path.join(path.dirname(repo), `${path.basename(repo)}-wt`);
    git(repo, ['worktree', 'add', '-q', wt]);
    const a = ledgerKey(repo);
    const b = ledgerKey(wt);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });

  // User behaviour: outside a repo there is no ledger to bind to.
  // Business rule: no git toplevel means no key.
  it('is null outside a git repo', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-plain-'));
    expect(ledgerKey(plain)).toBeNull();
  });
});

describe('ledger permissions', () => {
  // User behaviour: other local users cannot read or forge my run records.
  // Business rule: every ledger dir is 0700 and every ledger file is 0600.
  it('creates dirs 700 and files 600', () => {
    const l = openLedger(repo);
    l.appendRow('results/feat/build', { sha256: 'a' });
    l.writeMarker('pending/feat/build', { check: 'x', at: 'now' });
    const root = path.join(os.homedir(), '.oss', 'ledger');
    for (const d of [root, keyDir(repo), path.join(keyDir(repo), 'results'), path.join(keyDir(repo), 'results', 'feat')]) {
      expect(mode(d)).toBe(0o700);
    }
    expect(mode(path.join(keyDir(repo), 'results', 'feat', 'build'))).toBe(0o600);
    expect(mode(path.join(keyDir(repo), 'pending', 'feat', 'build'))).toBe(0o600);
  });

  // User behaviour: a planted link cannot redirect ledger writes or reads elsewhere.
  // Business rule: a symlinked ledger dir is refused with unsafe_path.
  it('refuses a symlinked ledger dir', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-elsewhere-'));
    fs.mkdirSync(path.join(os.homedir(), '.oss', 'ledger'), { mode: 0o700, recursive: true });
    fs.symlinkSync(elsewhere, keyDir(repo));
    expect(codeOf(() => openLedger(repo).appendRow('run/build', { startedAt: 't' }))).toBe('unsafe_path');
  });

  // Business rule: a symlinked ledger file is refused with unsafe_path, for writes and reads.
  it('refuses a symlinked ledger file', () => {
    const l = openLedger(repo);
    l.appendRow('run/plan', { startedAt: 't' });
    const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-target-')), 'x');
    fs.writeFileSync(target, '{"startedAt":"forged"}\n', { mode: 0o600 });
    fs.symlinkSync(target, path.join(keyDir(repo), 'run', 'build'));
    expect(codeOf(() => l.appendRow('run/build', { startedAt: 't' }))).toBe('unsafe_path');
    expect(codeOf(() => l.readRows('run/build'))).toBe('unsafe_path');
  });

  // Business rule: a ledger dir open to group or others is refused.
  it('refuses a dir with group/other bits', () => {
    const l = openLedger(repo);
    l.appendRow('run/build', { startedAt: 't' });
    fs.chmodSync(path.join(keyDir(repo), 'run'), 0o777);
    expect(codeOf(() => l.readRows('run/build'))).toBe('unsafe_path');
  });

  // Business rule: a ledger file open to group or others is refused.
  it('refuses a file with group/other bits', () => {
    const l = openLedger(repo);
    l.appendRow('run/build', { startedAt: 't' });
    fs.chmodSync(path.join(keyDir(repo), 'run', 'build'), 0o644);
    expect(codeOf(() => l.lastRow('run/build'))).toBe('unsafe_path');
  });

  // User behaviour: a ledger owned by another user is never trusted.
  // Business rule: owner must equal the current uid.
  it('refuses a ledger owned by another uid', () => {
    openLedger(repo).appendRow('run/build', { startedAt: 't' });
    const other = openLedger(repo, { getuid: () => (process.getuid ? process.getuid() : 0) + 1 });
    expect(codeOf(() => other.readRows('run/build'))).toBe('unsafe_path');
  });

  // Business rule: ledger paths are plain segments, never traversal or hidden names.
  it('refuses unsafe relative paths', () => {
    const l = openLedger(repo);
    for (const p of ['../x', 'run/../x', '.hidden/x', 'run//x', 'run/a b', '/abs']) {
      expect(codeOf(() => l.appendRow(p, { a: 1 }))).toBe('unsafe_path');
    }
  });
});

describe('ledger rows', () => {
  // User behaviour: concurrent hooks never corrupt each other's rows.
  // Business rule: each row is one O_APPEND write, so 50 parallel writers give 50 intact rows.
  it('keeps 50 parallel appends from separate processes intact', async () => {
    const script = `import(${JSON.stringify(LEDGER_SRC)}).then(m => m.openLedger(process.argv[1]).appendRow('gates/feat', { sha256: 'h'.repeat(64), n: Number(process.argv[2]) }))`;
    openLedger(repo).appendRow('gates/seed', { a: 1 });
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, ['--no-warnings', '-e', script, repo, String(i)], { env: process.env, stdio: 'inherit' });
          child.on('error', reject);
          child.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`child exit ${c}`))));
        }),
      ),
    );
    const rows = openLedger(repo).readRows('gates/feat');
    expect(rows).toHaveLength(50);
    expect(new Set(rows.map((r) => r.n)).size).toBe(50);
  }, 60_000);

  // Business rule: a row must be under 512 bytes so one write stays atomic.
  it('refuses a row of 512 bytes or more', () => {
    const l = openLedger(repo);
    expect(codeOf(() => l.appendRow('run/build', { pad: 'x'.repeat(600) }))).toBe('too_large');
  });

  // User behaviour: a bloated ledger never passes as verified.
  // Business rule: results/ and decisions/ cap at 1 MB, others at 4 MB; over gives ledger_too_large.
  it('gives ledger_too_large on an over-cap read', () => {
    const l = openLedger(repo);
    l.appendRow('results/feat/build', { sha256: 'a' });
    l.appendRow('run/build', { startedAt: 't' });
    const big = `${JSON.stringify({ pad: 'x'.repeat(1000) })}\n`.repeat(1100);
    fs.appendFileSync(path.join(keyDir(repo), 'results', 'feat', 'build'), big);
    fs.appendFileSync(path.join(keyDir(repo), 'run', 'build'), big);
    expect(codeOf(() => l.readRows('results/feat/build'))).toBe('ledger_too_large');
    expect(l.readRows('run/build').length).toBeGreaterThan(1000);
  });

  // User behaviour: a stray or garbled line never breaks or fakes the current value.
  // Business rule: lines that are not JSON objects are ignored; the last valid row wins.
  it('ignores garbage lines and the last valid row wins', () => {
    const l = openLedger(repo);
    l.appendRow('run/build', { startedAt: 'first' });
    l.appendRow('run/build', { startedAt: 'second' });
    fs.appendFileSync(path.join(keyDir(repo), 'run', 'build'), 'not json\n[1,2]\n"str"\nnull\n{"trunc');
    expect(l.readRows('run/build')).toEqual([{ startedAt: 'first' }, { startedAt: 'second' }]);
    expect(l.lastRow('run/build')).toEqual({ startedAt: 'second' });
    expect(l.lastRow('run/missing')).toBeNull();
  });

  // User behaviour: pending/unverified markers can be set, read, checked and cleared.
  // Business rule: markers are whole-file JSON objects under the same owner-only rules.
  it('writes, reads, detects and clears markers', () => {
    const l = openLedger(repo);
    expect(l.hasMarker('unverified/feat/build')).toBe(false);
    expect(l.readMarker('unverified/feat/build')).toBeNull();
    l.writeMarker('unverified/feat/build', { check: 'c', errorClass: 'timeout', at: 't' });
    expect(l.hasMarker('unverified/feat/build')).toBe(true);
    expect(l.readMarker('unverified/feat/build')).toEqual({ check: 'c', errorClass: 'timeout', at: 't' });
    l.clearMarker('unverified/feat/build');
    expect(l.hasMarker('unverified/feat/build')).toBe(false);
    l.clearMarker('unverified/feat/build');
  });
});
