/**
 * @behavior Round 12, D-R12-2 "Skip ignored folders" (PERF MEDIUM-1): the other repos inside a
 *   reviewed repo are found with cheap git calls that never list ignored files, so a repo with a
 *   large ignored build folder is checked quickly. Round 13 (D-R13-1): nothing is cached; git is asked
 *   on every call, so a repo cloned after a first check is found on the next one. A large index is
 *   read as a stream, keeping only the gitlinks, so it never fails closed. Nested repos in tracked and untracked-but-not-ignored places, submodules and
 *   worktrees are found; a clone inside an ignored folder is not (accepted limit). A git call that
 *   runs out of time says so.
 * @business-rule R-266: a review agent may read the repo it reviews, not the other repos inside it,
 *   and the check must not make ordinary review calls slow.
 * @boundary nestedRepos (nested-repos.ts) against real git repos in a temp folder; the git runner is
 *   the real one, wrapped to count calls and bytes (a collaborator at its interface).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nestedRepos, realGitRun, type GitRun } from '../../src/tool-gate/nested-repos.js';
import { withDeadline } from '../../src/tool-gate/deadline.js';

let root: string;
let top: string;

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'protocol.file.allow=always', ...args], { cwd, stdio: 'ignore' });
};

/** The real runner, counting its calls and the bytes git printed. */
function counting(): { run: GitRun; calls: number; bytes: number } {
  const counter = { calls: 0, bytes: 0, run: (async (args, cwd, keep, limitMs) => {
    counter.calls += 1;
    const out = await realGitRun(args, cwd, keep, limitMs);
    counter.bytes += out.stdout.length;
    return out;
  }) as GitRun };
  return counter;
}

function gitDirs(dir: string): { gitDir: string; commonDir: string } {
  return { gitDir: path.join(dir, '.git'), commonDir: path.join(dir, '.git') };
}

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-nested12-')));
  top = path.join(root, 'repo');
  fs.mkdirSync(path.join(top, 'src'), { recursive: true });
  git(top, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(top, '.gitignore'), 'build/\n');
  fs.writeFileSync(path.join(top, 'src', 'a.ts'), 'a\n');
  // ~100k ignored files under build/
  for (let d = 0; d < 100; d += 1) {
    const dir = path.join(top, 'build', `d${d}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let f = 0; f < 1000; f += 1) fs.writeFileSync(path.join(dir, `f${f}.o`), '');
  }
  // a submodule (a gitlink in the index)
  const lib = path.join(root, 'lib');
  fs.mkdirSync(lib);
  git(lib, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(lib, 'l.txt'), 'l\n');
  git(lib, 'add', '.');
  git(lib, 'commit', '-q', '-m', 'l');
  git(top, 'add', '.');
  git(top, 'commit', '-q', '-m', 'a');
  git(top, 'submodule', 'add', '-q', lib, 'vendor/lib');
  git(top, 'commit', '-q', '-m', 'sub');
  // nested repos: in a tracked folder, deep in an untracked plain folder, and in the ignored folder
  for (const name of ['src/inner', 'plain/deep/r', 'build/clone']) {
    fs.mkdirSync(path.join(top, name), { recursive: true });
    git(path.join(top, name), 'init', '-q', '-b', 'main');
  }
  fs.writeFileSync(path.join(top, 'plain', 'f.txt'), 'f\n');
}, 120_000);

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('D-R12-2: nested repos, cheaply', () => {
  it('never lists the ignored files: a few small git calls, however big the ignored build folder', async () => {
    const counter = counting();
    const found = await nestedRepos(top, gitDirs(top), [], { run: counter.run });
    expect(found.kind).toBe('found');
    // 100k ignored names would be well over 1 MB of output
    expect(counter.bytes).toBeLessThan(20_000);
    expect(counter.calls).toBeLessThanOrEqual(2);
  });

  it('finds nested repos in tracked and untracked places and the submodules, not a clone in an ignored folder (accepted limit)', async () => {
    const found = await nestedRepos(top, gitDirs(top), []);
    expect(found.kind === 'found' ? [...found.repos].sort() : found).toEqual([path.join(top, 'plain/deep/r'), path.join(top, 'src/inner'), path.join(top, 'vendor/lib')]);
  });

  it('leaves out the repos the session named as reviewed', async () => {
    const found = await nestedRepos(top, gitDirs(top), [path.join(top, 'vendor/lib')]);
    expect(found.kind === 'found' ? found.repos : found).not.toContain(path.join(top, 'vendor/lib'));
  });

  it('asks git on every call (nothing is cached), so a repo cloned into an untracked folder later is found', async () => {
    const first = counting();
    const before = await nestedRepos(top, gitDirs(top), [], { run: first.run });
    expect(first.calls).toBeGreaterThan(0);
    expect(before.kind === 'found' ? before.repos : before).not.toContain(path.join(top, 'plain/later'));
    // a clone into the existing untracked folder: the index, HEAD and the root folder are unchanged
    fs.mkdirSync(path.join(top, 'plain', 'later'));
    git(path.join(top, 'plain', 'later'), 'init', '-q', '-b', 'main');
    const second = counting();
    const after = await nestedRepos(top, gitDirs(top), [], { run: second.run });
    expect(second.calls).toBeGreaterThan(0);
    expect(after.kind === 'found' ? after.repos : after).toContain(path.join(top, 'plain/later'));
    fs.rmSync(path.join(top, 'plain', 'later'), { recursive: true, force: true });
  });

  it('says when git ran out of time, apart from git not being able to tell', async () => {
    const timedOut: GitRun = () => ({ status: null, stdout: '', timedOut: true });
    const failed: GitRun = () => ({ status: 128, stdout: '', timedOut: false });
    expect((await nestedRepos(top, gitDirs(top), [], { run: timedOut })).kind).toBe('timeout');
    expect((await nestedRepos(top, gitDirs(top), [], { run: failed })).kind).toBe('unknown');
  });
});

describe('CR I-a: a large index is streamed, keeping only the gitlinks', () => {
  /** Index entries, each with a long path: their `ls-files --stage` lines come to well over 16 MB. */
  const ENTRIES = 70_000;
  let big: string;

  beforeAll(() => {
    big = path.join(root, 'big');
    fs.mkdirSync(big);
    git(big, 'init', '-q', '-b', 'main');
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: big, input: '' , encoding: 'utf8' }).trim();
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: top, encoding: 'utf8' }).trim();
    const pad = 'p'.repeat(230);
    const lines = Array.from({ length: ENTRIES }, (_v, i) => `100644 ${blob}\td${i % 100}/${pad}-${i}.txt`);
    // one gitlink in the middle of the index
    lines.push(`160000 ${commit}\tm/link`);
    execFileSync('git', ['update-index', '--index-info'], { cwd: big, input: `${lines.join('\n')}\n`, maxBuffer: 64 * 1024 * 1024 });
  }, 120_000);

  it('finds the one gitlink among 70k entries (over 16 MB of git output) instead of failing closed', async () => {
    // the index really is that large: counted, not timed
    const listed = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: big, maxBuffer: 64 * 1024 * 1024 });
    expect(listed.length).toBeGreaterThan(16 * 1024 * 1024);
    expect(listed.toString('utf8').split('\0').filter((e) => e !== '').length).toBe(ENTRIES + 1);
    const found = await nestedRepos(big, gitDirs(big), []);
    expect(found).toEqual({ kind: 'found', repos: [path.join(big, 'm/link')] });
  });
});

describe('D-R14-2: the two git calls run side by side, on the time the call has left', () => {
  it('starts both git calls before either has finished', async () => {
    let started = 0;
    const startedWhenDone: number[] = [];
    const run: GitRun = async () => {
      started += 1;
      await new Promise((resolve) => setImmediate(resolve));
      startedWhenDone.push(started);
      return { status: 0, stdout: '', timedOut: false };
    };
    const found = await nestedRepos(top, gitDirs(top), [], { run });
    expect(found.kind).toBe('found');
    expect(startedWhenDone).toEqual([2, 2]);
  });

  it("gives each git call the decision's time left (not a fixed 500 ms), under an upper bound", async () => {
    const limits: number[] = [];
    const run: GitRun = (_args, _cwd, _keep, limitMs) => {
      limits.push(limitMs);
      return { status: 0, stdout: '', timedOut: false };
    };
    // 900 ms left in the decision: both calls may use all of it
    await withDeadline(900, () => 0, () => nestedRepos(top, gitDirs(top), [], { run }));
    expect(limits).toEqual([900, 900]);
    // outside a decision: the upper bound, still well under the hook's limit
    limits.length = 0;
    await nestedRepos(top, gitDirs(top), [], { run });
    expect(limits.length).toBe(2);
    expect(limits.every((ms) => ms >= 900 && ms <= 1500)).toBe(true);
  });
});

describe('CR INFO-2: temp folders left by a killed call do not pile up', () => {
  it('keeps them under one per-user parent and removes ones older than 10 minutes at the start of a scan', async () => {
    const tempRoot = path.join(root, 'tmp-info2');
    fs.mkdirSync(tempRoot, { mode: 0o700 });
    // a first scan makes the parent
    expect((await nestedRepos(top, gitDirs(top), [], { tempRoot })).kind).toBe('found');
    const parents = fs.readdirSync(tempRoot);
    expect(parents.length).toBe(1);
    const parent = path.join(tempRoot, parents[0] ?? '');
    expect(fs.lstatSync(parent).mode & 0o777).toBe(0o700);
    // what a killed call leaves behind: one old, one recent
    const old = path.join(parent, 'oss-nested-old');
    const recent = path.join(parent, 'oss-nested-recent');
    for (const dir of [old, recent]) {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'out'), 'x');
    }
    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(old, elevenMinutesAgo, elevenMinutesAgo);
    expect((await nestedRepos(top, gitDirs(top), [], { tempRoot })).kind).toBe('found');
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
    // the scan's own folders are gone when it ends
    expect(fs.readdirSync(parent).sort()).toEqual(['oss-nested-recent']);
  });
});
