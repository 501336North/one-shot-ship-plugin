/**
 * The ledger as the Stop hook uses it (R-257 ship fix round 1, findings 6 and 8).
 *
 * @behavior Every stop reads the latest run row; a huge ledger file must neither slow that down nor turn into a
 *           block the model cannot clear, and a git that hangs must not hang the stop.
 * @business-rule lastRow reads only the file's tail (rows are under 512 bytes, so the last row is always inside it),
 *           as `tail -n 1` does in the shell; every git child the ledger, the git helpers and feature resolution
 *           start is bounded at 2 s.
 * @boundary openLedger/ledgerKey (ledger.ts), gitOut (git.ts) and resolveFeature (feature.ts), with a real temp repo
 *           and, for the hang, a `git` on PATH that never answers (the external process is the collaborator).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ledgerKey, openLedger } from '../../src/phase-results/ledger.js';
import { gitOut } from '../../src/phase-results/git.js';
import { resolveFeature } from '../../src/phase-results/feature.js';

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return env;
}

let repo: string;
let savedPath: string | undefined;

beforeEach(() => {
  fs.rmSync(path.join(os.homedir(), '.oss', 'ledger'), { recursive: true, force: true });
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-stop-')));
  execFileSync('git', ['init', '-q', '-b', 'feat/f/build'], { cwd: repo, env: cleanEnv() });
  fs.mkdirSync(path.join(repo, '.oss', 'dev', 'active', 'f'), { recursive: true });
  savedPath = process.env.PATH;
});

afterEach(() => {
  process.env.PATH = savedPath;
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('lastRow reads the tail only (finding 8)', () => {
  // User behaviour: a results file grown past its 1 MB cap still gives the latest bound row to the Stop check, so
  // the stop is not blocked with an instruction ("assemble") that cannot fix an oversized file.
  it('returns the last row of a file over its read cap', () => {
    const l = openLedger(repo);
    const file = path.join(l.dir, 'results', 'f', 'plan');
    l.appendRow('results/f/plan', { startedAt: 'first' });
    fs.appendFileSync(file, `${JSON.stringify({ pad: 'x'.repeat(400) })}\n`.repeat(3000));
    l.appendRow('results/f/plan', { startedAt: 'latest' });
    expect(fs.statSync(file).size).toBeGreaterThan(1024 * 1024);
    expect(l.lastRow('results/f/plan')).toEqual({ startedAt: 'latest' });
  });

  // Rule: the last VALID row wins inside the tail, a torn last line included.
  it('skips a torn last line in the tail', () => {
    const l = openLedger(repo);
    l.appendRow('run/plan', { startedAt: 'a' });
    l.appendRow('run/plan', { startedAt: 'b' });
    fs.appendFileSync(path.join(l.dir, 'run', 'plan'), '{"startedAt":"tor');
    expect(l.lastRow('run/plan')).toEqual({ startedAt: 'b' });
  });
});

// ⚠ changes existing test: D33 (round 3). The hanging git sits first on PATH, which the fixed git (git-bin.ts) never
// runs, so these now check that a hung PATH git neither slows the stop nor stops it from answering. The 2 s execFile
// timeout stays in git.ts and ledger.ts for the fixed git itself.
describe('git children are bounded (finding 6)', () => {
  function hangingGit(): void {
    const bin = path.join(repo, '.hang-bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
    process.env.PATH = `${bin}:${savedPath ?? ''}`;
  }

  // User behaviour: a stop never waits on a git that does not answer. Rule: node-side git calls time out at 2 s.
  it('ledgerKey gives up on a hung git', () => {
    hangingGit();
    const t0 = Date.now();
    expect(ledgerKey(repo)).toMatch(/^[0-9a-f]{16}$/);
    expect(Date.now() - t0).toBeLessThan(8000);
  }, 20_000);

  it('gitOut gives up on a hung git', () => {
    hangingGit();
    const t0 = Date.now();
    expect(gitOut(repo, ['rev-parse', '--show-toplevel'])).toBe(repo);
    expect(Date.now() - t0).toBeLessThan(8000);
  }, 20_000);

  it('resolveFeature gives up on a hung git', () => {
    hangingGit();
    const t0 = Date.now();
    expect(resolveFeature(repo)).toBe('f');
    expect(Date.now() - t0).toBeLessThan(8000);
  }, 20_000);
});

describe('scanBack reads rows newest first (round 3, finding 1 and perf L3)', () => {
  // User behaviour: the Stop hook finds THIS session's latest run even when another session started a newer one, and
  // the archive check stops at the first old row, without reading a long file whole.
  // Rule: rows come newest to oldest, a torn line is skipped, and the scan stops as soon as visit returns false.
  it('visits rows newest to oldest across chunk borders and stops on false', () => {
    const l = openLedger(repo);
    for (let i = 0; i < 300; i++) l.appendRow('run/plan', { n: i, pad: 'x'.repeat(100) });
    fs.appendFileSync(path.join(l.dir, 'run', 'plan'), '{"n":"tor');
    const seen: unknown[] = [];
    l.scanBack('run/plan', (row) => {
      seen.push(row.n);
      return row.n !== 150;
    });
    expect(seen).toEqual(Array.from({ length: 150 }, (_, i) => 299 - i));
  });

  it('reaches the first row when visit never stops it, and a missing file visits nothing', () => {
    const l = openLedger(repo);
    l.appendRow('run/plan', { n: 0 });
    l.appendRow('run/plan', { n: 1 });
    const seen: unknown[] = [];
    l.scanBack('run/plan', (row) => (seen.push(row.n), true));
    expect(seen).toEqual([1, 0]);
    l.scanBack('run/ship', () => {
      throw new Error('visited a missing file');
    });
  });

  // Rule: the same link check as every other read.
  it('refuses a linked row file', () => {
    const l = openLedger(repo);
    l.appendRow('run/plan', { n: 0 });
    const f = path.join(l.dir, 'run', 'plan');
    fs.renameSync(f, `${f}.real`);
    fs.symlinkSync(`${f}.real`, f);
    expect(() => l.scanBack('run/plan', () => true)).toThrow(/unsafe_path/);
  });
});
