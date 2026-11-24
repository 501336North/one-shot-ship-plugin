/**
 * Result store (R-257 Task 3, amended P7, P8, S10).
 * Phase results are evidence that a phase really ran; the store must keep them where they belong
 * (inside the repo's results/ folder), whole (atomic) and bounded, and must never be tricked into
 * reading or writing somewhere else.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { resolveRepo, writeResult, readResult, readValueFile, readBack } from '../../src/phase-results/store.js';

let root: string;
let repo: string;

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-q', dir], { stdio: 'ignore' });
}

function resultsDir(feature = 'feat-a'): string {
  return path.join(repo, '.oss', 'dev', 'active', feature, 'results');
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-store-')));
  repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  gitInit(repo);
});

afterEach(() => {

  delete process.env.CLAUDE_PROJECT_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('resolveRepo', () => {
  // Behaviour: a result is filed in the repo the user is working in.
  // Rule: the repo comes from the cwd's physical git toplevel; CLAUDE_PROJECT_DIR (the session start folder) is ignored.
  it('should resolve the repo from the physical cwd git toplevel even when CLAUDE_PROJECT_DIR points elsewhere', () => {
    const other = path.join(root, 'other');
    fs.mkdirSync(other);
    gitInit(other);
    process.env.CLAUDE_PROJECT_DIR = other;
    const sub = path.join(repo, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    expect(resolveRepo(sub)).toBe(repo);
  });

  // Behaviour: outside a repo there is nowhere to file a result.
  // Rule: no git toplevel means null, never a guess.
  it('should return null when the cwd is not in a git repo', () => {
    const plain = path.join(root, 'plain');
    fs.mkdirSync(plain);
    expect(resolveRepo(plain)).toBeNull();
  });
});

describe('writeResult', () => {
  // Behaviour: a reader never sees half a result.
  // Rule: results are written to a temp file and renamed over the target.
  it('should write atomically: a reader at rename time sees the old whole file, never a partial one', () => {
    writeResult(repo, 'feat-a', 'build', { v: 1 });
    const target = path.join(resultsDir(), 'build.json');
    let seenAtRename: unknown = null;
    let tempComplete = false;
    writeResult(repo, 'feat-a', 'build', { v: 2, pad: 'x'.repeat(10000) }, {
      beforeRename: (tmp: string) => {
        seenAtRename = JSON.parse(fs.readFileSync(target, 'utf-8'));
        tempComplete = JSON.parse(fs.readFileSync(tmp, 'utf-8')).v === 2;
        expect(path.dirname(tmp)).toBe(resultsDir());
      },
    });
    expect(seenAtRename).toEqual({ v: 1 });
    expect(tempComplete).toBe(true);
    expect(JSON.parse(fs.readFileSync(target, 'utf-8')).v).toBe(2);
    expect(fs.readdirSync(resultsDir())).toEqual(['build.json']);
  });

  // Behaviour: a repo cannot redirect a result write outside itself.
  // Rule: a symlink at .oss, .oss/dev, .oss/dev/active, the feature dir, results/ or the target is unsafe_path.
  it.each([
    ['.oss'],
    ['.oss/dev'],
    ['.oss/dev/active'],
    ['.oss/dev/active/feat-a'],
    ['.oss/dev/active/feat-a/results'],
    ['.oss/dev/active/feat-a/results/plan.json'],
  ])('should refuse when %s is a symlink', (rel) => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    const link = path.join(repo, rel);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(outside, link);
    expect(() => writeResult(repo, 'feat-a', 'plan', { ok: true })).toThrow(/unsafe_path/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  // Behaviour: a feature name cannot climb out of .oss/dev/active.
  // Rule: feature must match ^[A-Za-z0-9._-]+$ and not start with "." (bad_feature).
  it.each([['..'], ['.hidden'], ['a/b'], ['a b'], [''], ['x\n']])('should refuse feature name %j', (feature) => {
    expect(() => writeResult(repo, feature, 'plan', {})).toThrow(/bad_feature/);
  });

  // Behaviour: only the four known phases have results.
  // Rule: any other phase is refused, so it cannot name another file.
  it('should refuse an unknown phase', () => {
    expect(() => writeResult(repo, 'feat-a', '../x' as 'plan', {})).toThrow(/unsafe_path/);
  });

  // Behaviour: a result stays small enough to read cheaply.
  // Rule: serialised JSON over 256 KB is too_large and nothing is written.
  it('should refuse a result over 256 KB', () => {
    expect(() => writeResult(repo, 'feat-a', 'ship', { pad: 'x'.repeat(256 * 1024) })).toThrow(/too_large/);
    expect(fs.existsSync(path.join(resultsDir(), 'ship.json'))).toBe(false);
  });

  // Behaviour: swapping results/ for a link mid-write cannot plant a result elsewhere.
  // Rule: results/ is re-checked right before the rename, and a swap is unsafe_path with nothing renamed.
  // ⚠ changes existing test: finding 9 (round 1 security) — the write refuses before the rename and never unlinks a
  //   path it did not create, so the earlier v1 result the swap moved out stays as it was; v2 never lands there.
  it('should detect results/ swapped for a symlink during the write', () => {
    writeResult(repo, 'feat-a', 'build', { v: 1 });
    const outside = path.join(root, 'outside');
    expect(() =>
      writeResult(repo, 'feat-a', 'build', { v: 2 }, {
        beforeRename: () => {
          fs.renameSync(resultsDir(), outside);
          fs.symlinkSync(outside, resultsDir());
        },
      }),
    ).toThrow(/unsafe_path/);
    expect(JSON.parse(fs.readFileSync(path.join(outside, 'build.json'), 'utf-8'))).toEqual({ v: 1 });
  });
});

/**
 * Round 1 finding 9 (TOCTOU): between the confinement check and the rename, a process can swap results/ for a link or
 * for another folder. The write re-checks the folder (realpath, device and inode) right before the rename, refuses on
 * any change, and never unlinks or overwrites a path it did not create.
 */
describe('writeResult: results/ swapped between check and rename (finding 9)', () => {
  it('a symlink swapped in never overwrites a file the store did not create', () => {
    fs.mkdirSync(resultsDir(), { recursive: true });
    const outside = path.join(root, 'outside');
    const theirs = path.join(root, 'theirs');
    fs.mkdirSync(theirs);
    fs.writeFileSync(path.join(theirs, 'build.json'), 'theirs');
    expect(() =>
      writeResult(repo, 'feat-a', 'build', { v: 2 }, {
        beforeRename: () => {
          fs.renameSync(resultsDir(), outside);
          fs.symlinkSync(theirs, resultsDir());
        },
      }),
    ).toThrow(/unsafe_path/);
    expect(fs.readFileSync(path.join(theirs, 'build.json'), 'utf-8')).toBe('theirs');
  });

  it('a different real folder swapped in at the same path is refused, and nothing lands in it', () => {
    fs.mkdirSync(resultsDir(), { recursive: true });
    expect(() =>
      writeResult(repo, 'feat-a', 'build', { v: 2 }, {
        beforeRename: () => {
          fs.renameSync(resultsDir(), `${resultsDir()}.old`);
          fs.mkdirSync(resultsDir());
        },
      }),
    ).toThrow(/unsafe_path/);
    expect(fs.readdirSync(resultsDir())).toEqual([]);
  });

  it('a file planted at the temp name in a swapped folder is neither moved nor deleted', () => {
    fs.mkdirSync(resultsDir(), { recursive: true });
    let planted = '';
    expect(() =>
      writeResult(repo, 'feat-a', 'build', { v: 2 }, {
        beforeRename: (tmp: string) => {
          fs.renameSync(resultsDir(), `${resultsDir()}.old`);
          fs.mkdirSync(resultsDir());
          planted = tmp;
          fs.writeFileSync(tmp, 'theirs');
        },
      }),
    ).toThrow(/unsafe_path/);
    expect(fs.readFileSync(planted, 'utf-8')).toBe('theirs');
    expect(fs.existsSync(path.join(resultsDir(), 'build.json'))).toBe(false);
  });
});

// ⚠ changes existing test: pen N3 (round 2, MEDIUM) — git runs from a fixed path, never PATH, so a hanging `git`
//   planted on PATH is never run at all (it used to be run and bounded at 2 s).
describe('resolveRepo: git from a fixed path, never PATH (pen N3)', () => {
  // Behaviour: a program named git that the model planted early on PATH cannot decide which repo a result belongs to.
  it('never runs a fake git planted on PATH', () => {
    const shims = path.join(root, 'shims');
    const ran = path.join(root, 'fake-git-ran');
    fs.mkdirSync(shims);
    fs.writeFileSync(path.join(shims, 'git'), `#!/bin/sh\ntouch '${ran}'\nexec sleep 10\n`);
    fs.chmodSync(path.join(shims, 'git'), 0o755);
    const saved = process.env.PATH;
    process.env.PATH = `${shims}:${saved ?? ''}`;
    try {
      expect(resolveRepo(repo)).toBe(repo);
    } finally {
      process.env.PATH = saved;
    }
    expect(fs.existsSync(ran)).toBe(false);
  }, 15_000);
});

/**
 * Pen round 2 (MEDIUM): assemble hashed the bytes it read back, so a loop swapping files into results/ could get forged
 * bytes bound. readBack accepts the read only when it is the very file writeResult created (same device and inode)
 * holding exactly the bytes it wrote.
 */
describe('readBack: the bound bytes are the written bytes (round 2 race)', () => {
  // Behaviour: a result swapped in between write and read-back is refused, never bound.
  it('refuses a different file renamed over the written result', () => {
    const written = writeResult(repo, 'feat-a', 'plan', { a: 1 });
    const forged = path.join(resultsDir(), 'forged.tmp');
    fs.writeFileSync(forged, JSON.stringify({ a: 1 }));
    fs.renameSync(forged, path.join(resultsDir(), 'plan.json'));
    expect(readBack(repo, 'feat-a', 'plan', written)).toEqual({ ok: false, error: 'result_changed' });
  });

  it('refuses the same file rewritten in place', () => {
    const written = writeResult(repo, 'feat-a', 'plan', { a: 1 });
    fs.writeFileSync(path.join(resultsDir(), 'plan.json'), JSON.stringify({ a: 2 }));
    expect(readBack(repo, 'feat-a', 'plan', written)).toEqual({ ok: false, error: 'result_changed' });
  });

  it('accepts the untouched file and gives the written bytes', () => {
    const written = writeResult(repo, 'feat-a', 'plan', { a: 1 });
    const r = readBack(repo, 'feat-a', 'plan', written);
    expect(r.ok).toBe(true);
    expect(r.ok && r.bytes.toString('utf-8')).toBe(JSON.stringify({ a: 1 }));
  });
});

describe('readResult', () => {
  // Behaviour: a written result reads back as the same value and bytes.
  // Rule: round trip through the store keeps the JSON intact.
  it('should read back a written result', () => {
    writeResult(repo, 'feat-a', 'plan', { tasks: 3 });
    const r = readResult(repo, 'feat-a', 'plan');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ tasks: 3 });
      expect(r.bytes.toString('utf-8')).toBe(JSON.stringify({ tasks: 3 }));
    }
  });

  // Behaviour: no result yet is reported plainly.
  // Rule: an absent file is `missing`.
  it('should report a missing result', () => {
    expect(readResult(repo, 'feat-a', 'ship')).toEqual({ ok: false, error: 'missing' });
  });

  // Behaviour: a corrupt result is not trusted.
  // Rule: unparsable JSON is invalid_json.
  it('should report invalid JSON', () => {
    fs.mkdirSync(resultsDir(), { recursive: true });
    fs.writeFileSync(path.join(resultsDir(), 'plan.json'), '{nope');
    expect(readResult(repo, 'feat-a', 'plan')).toEqual({ ok: false, error: 'invalid_json' });
  });

  // Behaviour: an oversized planted file is not read as a result.
  // Rule: a file over 256 KB is too_large.
  it('should report a file over 256 KB as too_large', () => {
    fs.mkdirSync(resultsDir(), { recursive: true });
    fs.writeFileSync(path.join(resultsDir(), 'plan.json'), JSON.stringify({ pad: 'x'.repeat(256 * 1024) }));
    expect(readResult(repo, 'feat-a', 'plan')).toEqual({ ok: false, error: 'too_large' });
  });

  // Behaviour: a FIFO planted as a result never freezes the session.
  // Rule: a non-regular file is unsafe_path, returned at once.
  it('should read a FIFO as unsafe, not hang', () => {
    fs.mkdirSync(resultsDir(), { recursive: true });
    execFileSync('mkfifo', [path.join(resultsDir(), 'build.json')]);
    const t0 = Date.now();
    expect(readResult(repo, 'feat-a', 'build')).toEqual({ ok: false, error: 'unsafe_path' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  // Behaviour: a result hard-linked from elsewhere is not trusted.
  // Rule: nlink must be 1, else unsafe_path.
  it('should read a hard-linked result (nlink 2) as unsafe', () => {
    writeResult(repo, 'feat-a', 'plan', { a: 1 });
    fs.linkSync(path.join(resultsDir(), 'plan.json'), path.join(root, 'twin.json'));
    expect(readResult(repo, 'feat-a', 'plan')).toEqual({ ok: false, error: 'unsafe_path' });
  });

  // Behaviour: a result that is a link to another file is not followed.
  // Rule: the target is opened with O_NOFOLLOW; a symlink is unsafe_path.
  it('should read a symlinked result as unsafe', () => {
    fs.mkdirSync(resultsDir(), { recursive: true });
    const real = path.join(root, 'real.json');
    fs.writeFileSync(real, '{}');
    fs.symlinkSync(real, path.join(resultsDir(), 'plan.json'));
    expect(readResult(repo, 'feat-a', 'plan')).toEqual({ ok: false, error: 'unsafe_path' });
  });
});

describe('readValueFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(root, 'run');
    fs.mkdirSync(dir);
  });

  // Behaviour: the model's fresh value file is read.
  // Rule: a small, recent regular file returns its text.
  it('should read a fresh value file', () => {
    fs.writeFileSync(path.join(dir, 'tasks.json'), '[1]');
    expect(readValueFile(dir, 'tasks.json')).toBe('[1]');
  });

  // Behaviour: a huge value file cannot stall or exhaust the hook.
  // Rule: at most 64 KB + 1 bytes are read; more means null (too_large).
  it('should refuse a 10 MB value file without reading it all', () => {
    const file = path.join(dir, 'big.txt');
    fs.writeFileSync(file, Buffer.alloc(10 * 1024 * 1024, 0x61));
    expect(readValueFile(dir, 'big.txt')).toBeNull();
    // Proof the read is bounded: a sparse 4 GB file cannot be read in full (Node refuses >2 GB reads, and the
    // allocation alone would take seconds), so a quick null means only the 64 KB + 1 prefix was read.
    const huge = path.join(dir, 'huge.txt');
    fs.closeSync(fs.openSync(huge, 'w'));
    fs.truncateSync(huge, 4 * 1024 * 1024 * 1024);
    const t0 = Date.now();
    expect(readValueFile(dir, 'huge.txt')).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  // Behaviour: a leftover value file from an earlier run is not reused.
  // Rule: a file whose mtime is over 10 minutes old is treated as absent.
  it('should ignore a stale value file', () => {
    const file = path.join(dir, 'tasks.json');
    fs.writeFileSync(file, '[1]');
    const old = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(file, old, old);
    expect(readValueFile(dir, 'tasks.json')).toBeNull();
  });

  // Behaviour: a value file cannot be a link to a secret elsewhere.
  // Rule: opened with O_NOFOLLOW; a symlink gives null.
  it('should refuse a symlinked value file', () => {
    const real = path.join(root, 'secret');
    fs.writeFileSync(real, 'k');
    fs.symlinkSync(real, path.join(dir, 'v.txt'));
    expect(readValueFile(dir, 'v.txt')).toBeNull();
  });

  // Behaviour: a FIFO value file never hangs.
  // Rule: it must be a regular file, else null.
  it('should refuse a FIFO value file without hanging', () => {
    execFileSync('mkfifo', [path.join(dir, 'v.txt')]);
    expect(readValueFile(dir, 'v.txt')).toBeNull();
  });

  // Behaviour: a missing value file is simply absent.
  // Rule: missing gives null.
  it('should return null for a missing value file', () => {
    expect(readValueFile(dir, 'nope.txt')).toBeNull();
  });
});
