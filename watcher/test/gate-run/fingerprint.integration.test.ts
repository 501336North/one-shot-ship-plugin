/**
 * @behavior A repo's fingerprint at a review run's start is compared with the repo at its end, and
 *   every change a review agent could make to what ships is named: work-tree files (tracked, new,
 *   deleted; also files marked assume-unchanged or skip-worktree), OSS's own files under .oss/ except
 *   its run files, and the git state outside the work tree (HEAD, every ref, stash, tags, config,
 *   hooks, info/, index flags, worktree list), in nested repos too. A changed config, hooks or info/
 *   is reported without running `git add`, so a filter the reviewer added never runs. User-level git
 *   ignore and attributes files cannot hide a new file. The repo's real index is never touched, and
 *   the check stops when its time budget runs out.
 * @business-rule A review is only worth something if the code it judged is the code that ships, and
 *   a review agent must not be able to change the repo unseen.
 * @user-story US-008 Any repo change during a review voids it (R-266, ADR-007, ADR-009, ADR-011)
 * @boundary printRepo / changesSince / OSS_RUN_FILES (watcher/src/gate-run/fingerprint.ts), real temp git repos
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OSS_RUN_FILES, changesSince, printRepo, type PrintContext, type RepoPrint } from '../../src/gate-run/fingerprint.js';
import { BudgetExceeded } from '../../src/gate-run/git.js';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function put(repo: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
}

/** A throwaway repo with tracked files, an ignore rule and one commit. */
function makeRepo(prefix = 'oss-fp-'): string {
  const repo = tempDir(prefix);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Fingerprint Test']);
  git(repo, ['config', 'user.email', 'fingerprint-test@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  put(repo, 'src/app.ts', 'export const a = 1;\n');
  put(repo, 'src/old.ts', 'export const old = 1;\n');
  put(repo, '.gitignore', 'ignored.log\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'initial']);
  return repo;
}

/** The run's own folder (temporary index, excludes, object copy) and the user's HOME for one start/stop. */
let runDir = '';
let home = '';
function ctx(deadline = Date.now() + 30_000): PrintContext {
  return { budget: { deadline }, runDir, home };
}

async function start(repo: string): Promise<RepoPrint> {
  runDir = tempDir('oss-fp-run-');
  home = tempDir('oss-fp-home-');
  return printRepo(repo, ctx());
}

async function stop(repo: string, before: RepoPrint): Promise<string[]> {
  return changesSince(repo, before, ctx());
}

describe('the repo fingerprint of a review run (R-266)', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('names every modified, added and deleted non-ignored file, and nothing for an ignored one (build output: user decision)', async () => {
    const repo = makeRepo();
    const before = await start(repo);
    put(repo, 'src/app.ts', 'export const a = 2;\n');
    put(repo, 'notes.txt', 'new\n');
    fs.rmSync(path.join(repo, 'src/old.ts'));
    put(repo, 'ignored.log', 'x\n');

    expect(await stop(repo, before)).toEqual(['notes.txt', 'src/app.ts', 'src/old.ts']);
  });

  it('names nothing when nothing changed', async () => {
    const repo = makeRepo();
    const before = await start(repo);

    expect(await stop(repo, before)).toEqual([]);
  });

  it("leaves the real index as it was and removes its temporary index", async () => {
    const repo = makeRepo();
    put(repo, 'staged.txt', 'staged\n');
    git(repo, ['add', 'staged.txt']);
    put(repo, 'src/app.ts', 'export const a = 3;\n');
    const indexBefore = git(repo, ['ls-files', '--stage', '--debug']);
    const before = await start(repo);
    put(repo, 'src/app.ts', 'export const a = 4;\n');
    await stop(repo, before);

    expect(git(repo, ['ls-files', '--stage', '--debug'])).toBe(indexBefore);
    expect(fs.readdirSync(runDir)).toEqual(['objects']);
  });

  it('sees a same-size edit made in the same second as the last index write (racy git)', async () => {
    const repo = makeRepo();
    const second = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
    put(repo, 'src/app.ts', 'export const a = 7;\n');
    fs.utimesSync(path.join(repo, 'src/app.ts'), second, second);
    git(repo, ['add', 'src/app.ts']);
    fs.utimesSync(path.join(repo, '.git/index'), second, second);
    const before = await start(repo);

    put(repo, 'src/app.ts', 'export const a = 8;\n');
    fs.utimesSync(path.join(repo, 'src/app.ts'), second, second);

    expect(await stop(repo, before)).toEqual(['src/app.ts']);
  });

  it.each([['--assume-unchanged'], ['--skip-worktree']])(
    'still sees an edit to a file already marked %s in the real index',
    async (flag) => {
      const repo = makeRepo();
      git(repo, ['update-index', flag, 'src/app.ts']);
      const before = await start(repo);
      put(repo, 'src/app.ts', 'export const a = 99; // a longer line\n');

      expect(await stop(repo, before)).toEqual(['src/app.ts']);
    },
  );

  it('cannot be blinded by a user-level ignore file or git config', async () => {
    const repo = makeRepo();
    const fakeHome = tempDir('oss-fp-home-');
    put(fakeHome, '.config/git/ignore', 'hidden.txt\n');
    put(fakeHome, '.gitconfig', '[core]\n\texcludesFile = ~/.myignore\n');
    put(fakeHome, '.myignore', 'hidden2.txt\n');
    const saved = { HOME: process.env.HOME, XDG: process.env.XDG_CONFIG_HOME };
    process.env.HOME = fakeHome;
    process.env.XDG_CONFIG_HOME = path.join(fakeHome, '.config');
    try {
      const before = await start(repo);
      put(repo, 'hidden.txt', 'x\n');
      put(repo, 'hidden2.txt', 'x\n');

      expect(await stop(repo, before)).toEqual(['hidden.txt', 'hidden2.txt']);
    } finally {
      process.env.HOME = saved.HOME;
      if (saved.XDG === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = saved.XDG;
    }
  });

  it('stops with BudgetExceeded when the time budget is spent', async () => {
    const repo = makeRepo();

    runDir = tempDir('oss-fp-run-');
    await expect(printRepo(repo, ctx(Date.now() - 1))).rejects.toThrow(BudgetExceeded);
  });
});

describe("OSS's files under .oss/: only its run files are left out (ADR-011)", () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('keeps the exact list of left-out run files in one place', async () => {
    expect(OSS_RUN_FILES).toEqual([
      '.oss/logs/**',
      '.oss/workflow.log',
      '.oss/sessions/**',
      '.oss/locks/**',
      '.oss/run/**',
      '.oss/session-context.md',
      '.oss/workflow-state.json',
      '.oss/health-workflow-state.json',
      '.oss/queue.json',
      '.oss/current-project',
      '.oss/timeline-outbox/**',
      '.oss/tool-gates/**',
      '.oss/.iron-laws-*',
      '.oss/dev/timeline-unfiled.ndjson',
      '.oss/dev/active/*/timeline.ndjson',
      '.oss/dev/completed/*/timeline.ndjson',
    ]);
  });

  it('does not void a run when only OSS run files change, tracked or new', async () => {
    const repo = makeRepo();
    put(repo, '.oss/dev/active/x/timeline.ndjson', '{"a":1}\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'tracked timeline']);
    const before = await start(repo);
    for (const file of [
      '.oss/logs/session.log',
      '.oss/workflow.log',
      '.oss/sessions/s.json',
      '.oss/locks/l',
      '.oss/run/r',
      '.oss/session-context.md',
      '.oss/workflow-state.json',
      '.oss/health-workflow-state.json',
      '.oss/queue.json',
      '.oss/current-project',
      '.oss/timeline-outbox/o.ndjson',
      '.oss/tool-gates/events.ndjson',
      '.oss/.iron-laws-hash',
      '.oss/dev/timeline-unfiled.ndjson',
      '.oss/dev/active/x/timeline.ndjson',
      '.oss/dev/completed/y/timeline.ndjson',
    ]) {
      put(repo, file, `changed ${file}\n`);
    }

    expect(await stop(repo, before)).toEqual([]);
  });

  it('works in a repo that gitignores OSS run files, tracked or not (a common setup)', async () => {
    const repo = makeRepo();
    put(repo, '.oss/queue.json', '[]\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'tracked queue']);
    put(repo, '.gitignore', 'ignored.log\n.oss/workflow-state.json\n.oss/queue.json\n.oss/logs/\n');
    put(repo, '.oss/workflow-state.json', '{}\n');
    put(repo, '.oss/logs/a.log', 'x\n');
    git(repo, ['add', '.gitignore']);
    git(repo, ['commit', '-q', '-m', 'ignore run files']);
    const before = await start(repo);
    put(repo, '.oss/workflow-state.json', '{"changed":true}\n');
    put(repo, 'src/app.ts', 'export const a = 10;\n');

    expect(await stop(repo, before)).toEqual(['src/app.ts']);
  });

  it('voids a run that changes any other file under .oss/: decisions, dev docs, gate config', async () => {
    const repo = makeRepo();
    put(repo, '.oss/dev/active/x/PLAN.md', '# Plan\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'dev docs']);
    const before = await start(repo);
    put(repo, '.oss/dev/active/x/PLAN.md', '# Plan, rewritten\n');
    put(repo, '.oss/decisions.ndjson', '{"pick":"x"}\n');
    put(repo, '.oss/tool-gates.json', '{"gateAgents":[]}\n');
    put(repo, '.oss/config.json', '{}\n');
    put(repo, '.oss/dev/active/x/timeline.ndjson.bak', 'x\n');

    expect(await stop(repo, before)).toEqual([
      '.oss/config.json',
      '.oss/decisions.ndjson',
      '.oss/dev/active/x/PLAN.md',
      '.oss/dev/active/x/timeline.ndjson.bak',
      '.oss/tool-gates.json',
    ]);
  });
});

describe('the git state outside the work tree (R-266)', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it.each<[string, (repo: string) => void, string[]]>([
    ['a commit (HEAD moves)', (r) => git(r, ['commit', '-q', '--allow-empty', '-m', 'x']), ['(git) HEAD', '(git) refs/heads/main', '(git) worktree list']],
    ['a branch switch', (r) => git(r, ['checkout', '-q', '-b', 'other']), ['(git) HEAD', '(git) refs/heads/other', '(git) worktree list']],
    ['a new branch', (r) => git(r, ['branch', 'x']), ['(git) refs/heads/x']],
    ['a tag', (r) => git(r, ['tag', 'v1']), ['(git) refs/tags/v1']],
    ['a note', (r) => git(r, ['notes', 'add', '-m', 'n']), ['(git) refs/notes/commits']],
    ['a config change', (r) => git(r, ['config', 'core.hooksPath', '/tmp']), ['(git) config']],
    ['a new hook', (r) => put(r, '.git/hooks/pre-commit', '#!/bin/sh\n'), ['(git) .git/hooks']],
    ['an info/exclude rule', (r) => put(r, '.git/info/exclude', 'src/\n'), ['(git) .git/info']],
    ['an assume-unchanged flag', (r) => git(r, ['update-index', '--assume-unchanged', 'src/app.ts']), ['(git) index flags']],
    ['a skip-worktree flag', (r) => git(r, ['update-index', '--skip-worktree', 'src/app.ts']), ['(git) index flags']],
  ])('names %s', async (_label, change, expected) => {
    const repo = makeRepo();
    const before = await start(repo);

    change(repo);

    expect(await stop(repo, before)).toEqual(expected);
  });

  it('names a stash (and the files it reverted)', async () => {
    const repo = makeRepo();
    put(repo, 'src/app.ts', 'export const a = 5;\n');
    const before = await start(repo);

    git(repo, ['stash', '-q']);

    expect(await stop(repo, before)).toEqual(['(git) refs/stash', 'src/app.ts']);
  });

  it('names a new worktree', async () => {
    const repo = makeRepo();
    const before = await start(repo);
    const other = path.join(tempDir('oss-fp-wt-'), 'wt');

    git(repo, ['worktree', 'add', '-q', other, '-b', 'wt-branch']);

    expect(await stop(repo, before)).toEqual(['(git) refs/heads/wt-branch', '(git) worktree list']);
  });

  it("names a change to the worktree's own config.worktree", async () => {
    const repo = makeRepo();
    git(repo, ['config', 'extensions.worktreeConfig', 'true']);
    const before = await start(repo);

    git(repo, ['config', '--worktree', 'user.name', 'Someone Else']);

    expect(await stop(repo, before)).toEqual(['(git) config.worktree']);
  });

  it('names a change in a core.hooksPath folder set in the repo config', async () => {
    const repo = makeRepo();
    const hooks = tempDir('oss-fp-hooks-');
    git(repo, ['config', 'core.hooksPath', hooks]);
    const before = await start(repo);

    put(hooks, 'pre-push', '#!/bin/sh\n');

    expect(await stop(repo, before)).toEqual(['(git) .git/hooks']);
  });

  it('reports a config change without running git add, so a clean filter added during the run never runs', async () => {
    const repo = makeRepo();
    put(repo, '.git/info/attributes', '*.ts filter=evil\n');
    const marker = path.join(tempDir('oss-fp-marker-'), 'ran');
    const before = await start(repo);

    git(repo, ['config', 'filter.evil.clean', `touch ${marker}; cat`]);
    put(repo, 'src/app.ts', 'export const a = 6;\n');

    expect(await stop(repo, before)).toEqual(['(git) config']);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('reports a changed info/ without running git add (files changed too are not listed)', async () => {
    const repo = makeRepo();
    const before = await start(repo);

    put(repo, '.git/info/exclude', 'notes.txt\n');
    put(repo, 'notes.txt', 'x\n');

    expect(await stop(repo, before)).toEqual(['(git) .git/info']);
  });
});

describe('nested repos (submodules and embedded repos) are checked too (R-266)', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  /** A repo with a nested repo at vendor/lib: committed as a gitlink when `tracked`, else left untracked. */
  function repoWithNested(tracked = true): { repo: string; nested: string } {
    const repo = makeRepo();
    const nested = path.join(repo, 'vendor', 'lib');
    fs.mkdirSync(nested, { recursive: true });
    git(nested, ['init', '-q', '-b', 'main']);
    git(nested, ['config', 'user.name', 'Nested']);
    git(nested, ['config', 'user.email', 'nested@example.com']);
    git(nested, ['config', 'commit.gpgsign', 'false']);
    put(nested, 'lib.ts', 'export const lib = 1;\n');
    git(nested, ['add', '-A']);
    git(nested, ['commit', '-q', '-m', 'lib']);
    if (tracked) {
      git(repo, ['add', 'vendor/lib']);
      git(repo, ['commit', '-q', '-m', 'gitlink']);
    }
    return { repo, nested };
  }

  it("names a change to a nested repo's files with its path", async () => {
    const { repo, nested } = repoWithNested();
    const before = await start(repo);

    put(nested, 'lib.ts', 'export const lib = 2;\n');
    put(nested, 'extra.ts', 'x\n');

    expect(await stop(repo, before)).toEqual(['vendor/lib/extra.ts', 'vendor/lib/lib.ts']);
  });

  it("names a change to a nested repo's git state with its path", async () => {
    const { repo, nested } = repoWithNested();
    const before = await start(repo);

    git(nested, ['branch', 'side']);
    put(nested, '.git/hooks/post-checkout', '#!/bin/sh\n');

    expect(await stop(repo, before)).toEqual(['(git) vendor/lib: .git/hooks', '(git) vendor/lib: refs/heads/side']);
  });

  it('says nothing when a nested repo did not change', async () => {
    const { repo } = repoWithNested();
    const before = await start(repo);

    expect(await stop(repo, before)).toEqual([]);
  });

  // An untracked nested repo (another session's live worktree under .claude/worktrees, a vendored
  // checkout) is recorded like a gitlink: its HEAD commit and branch only. Edits in its work tree are
  // not checked (another session's normal work must not void a review; the tool gate refuses a review
  // agent's direct writes there, interpreter writes are the recorded limit).
  it("does not void a run for an edit inside an untracked nested repo's work tree", async () => {
    const { repo, nested } = repoWithNested(false);
    const before = await start(repo);

    put(nested, 'lib.ts', 'export const lib = 2;\n');
    put(nested, 'extra.ts', 'x\n');

    expect(await stop(repo, before)).toEqual([]);
  });

  it('voids a run when an untracked nested repo gets a new commit or switches branch', async () => {
    const { repo, nested } = repoWithNested(false);
    let before = await start(repo);
    put(nested, 'lib.ts', 'export const lib = 3;\n');
    git(nested, ['commit', '-qam', 'more']);
    expect(await stop(repo, before)).toEqual(['vendor/lib']);

    before = await start(repo);
    git(nested, ['checkout', '-q', '-b', 'other']);
    expect(await stop(repo, before)).toEqual(['vendor/lib']);
  });

  it("never reads an untracked nested repo's index or work tree (no nested fingerprint)", async () => {
    const { repo, nested } = repoWithNested(false);
    fs.writeFileSync(path.join(nested, '.git', 'index'), 'not an index');

    const before = await start(repo);

    expect(before.nested).toEqual({});
    expect(await stop(repo, before)).toEqual([]);
  });
});

describe('gitignored dependency folders (node_modules) are checked too (user decision)', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  /** A repo that ignores node_modules (root and workspace packages) and build/, with installed files. */
  function repoWithDeps(): string {
    const repo = makeRepo();
    put(repo, '.gitignore', 'ignored.log\nnode_modules/\nbuild/\n');
    put(repo, 'packages/a/package.json', '{}\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'ignore deps']);
    put(repo, 'node_modules/foo/index.js', 'module.exports = 1;\n');
    put(repo, 'node_modules/foo/old.js', 'old\n');
    put(repo, 'node_modules/foo/node_modules/bar/bar.js', 'bar\n');
    put(repo, 'packages/a/node_modules/b/i.js', 'b\n');
    fs.mkdirSync(path.join(repo, 'node_modules/.bin'), { recursive: true });
    fs.symlinkSync('../foo/index.js', path.join(repo, 'node_modules/.bin/foo'));
    return repo;
  }

  it('names a changed, added or deleted file under node_modules, with its path from the repo top', async () => {
    const repo = repoWithDeps();
    const before = await start(repo);

    put(repo, 'node_modules/foo/index.js', 'module.exports = 2; // patched\n');
    put(repo, 'node_modules/foo/new.js', 'new\n');
    fs.rmSync(path.join(repo, 'node_modules/foo/old.js'));

    expect(await stop(repo, before)).toEqual(['node_modules/foo/index.js', 'node_modules/foo/new.js', 'node_modules/foo/old.js']);
  });

  it('sees a same-size rewrite through its mtime', async () => {
    const repo = repoWithDeps();
    const before = await start(repo);
    const file = path.join(repo, 'node_modules/foo/index.js');
    const later = new Date(fs.statSync(file).mtimeMs + 5000);

    fs.writeFileSync(file, 'module.exports = 9;\n');
    fs.utimesSync(file, later, later);

    expect(await stop(repo, before)).toEqual(['node_modules/foo/index.js']);
  });

  it('names nested node_modules and workspace package node_modules', async () => {
    const repo = repoWithDeps();
    const before = await start(repo);

    put(repo, 'node_modules/foo/node_modules/bar/bar.js', 'bar, patched\n');
    put(repo, 'packages/a/node_modules/b/i.js', 'b, patched\n');

    expect(await stop(repo, before)).toEqual(['node_modules/foo/node_modules/bar/bar.js', 'packages/a/node_modules/b/i.js']);
  });

  it('records a symlink by its target text and does not follow it', async () => {
    const repo = repoWithDeps();
    const outside = tempDir('oss-fp-outside-');
    put(outside, 'tool.js', 'x\n');
    fs.symlinkSync(outside, path.join(repo, 'node_modules/linked'));
    const before = await start(repo);

    put(outside, 'tool.js', 'changed outside the repo\n');
    expect(await stop(repo, before)).toEqual([]);

    const again = await start(repo);
    fs.rmSync(path.join(repo, 'node_modules/.bin/foo'));
    fs.symlinkSync('../foo/old.js', path.join(repo, 'node_modules/.bin/foo'));
    expect(await stop(repo, again)).toEqual(['node_modules/.bin/foo']);
  });

  it('skips tool caches: node_modules/.cache, .vite, .vitest and other .vite* folders, at any depth', async () => {
    const repo = repoWithDeps();
    const before = await start(repo);

    put(repo, 'node_modules/.cache/x.json', 'x\n');
    put(repo, 'node_modules/.vite/deps/a.js', 'x\n');
    put(repo, 'node_modules/.vitest/results.json', 'x\n');
    put(repo, 'node_modules/.vite-temp/b.js', 'x\n');
    put(repo, 'packages/a/node_modules/.cache/y.json', 'y\n');
    put(repo, 'node_modules/foo/node_modules/.vite/z.js', 'z\n');

    expect(await stop(repo, before)).toEqual([]);
  });

  it('does not walk a node_modules inside another ignored folder', async () => {
    const repo = repoWithDeps();
    put(repo, 'build/node_modules/x/x.js', 'x\n');
    const before = await start(repo);

    put(repo, 'build/node_modules/x/x.js', 'x, changed\n');

    expect(await stop(repo, before)).toEqual([]);
  });

  it('still names the files of a node_modules folder deleted during the run', async () => {
    const repo = repoWithDeps();
    put(repo, 'packages/a/.gitignore', 'node_modules/\n');
    const before = await start(repo);

    fs.rmSync(path.join(repo, 'packages/a/node_modules'), { recursive: true });

    expect(await stop(repo, before)).toEqual(['packages/a/node_modules/b/i.js']);
  });
});

/** Every file under a folder (recursive, relative), sorted. */
function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(path.relative(dir, abs));
    }
  };
  walk(dir);
  return out.sort();
}

describe('ship round 2: what a review agent could still change unseen (R-266)', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('names a staged-only change (index differs, work tree as before) as (git) staged changes', async () => {
    const repo = makeRepo();
    const before = await start(repo);

    put(repo, 'src/app.ts', 'export const a = 42;\n');
    git(repo, ['add', 'src/app.ts']);
    put(repo, 'src/app.ts', 'export const a = 1;\n');

    expect(await stop(repo, before)).toEqual(['(git) staged changes']);
  });

  it('names a node_modules file rewritten at the same size with its mtime put back (ctime)', async () => {
    const repo = makeRepo();
    put(repo, '.gitignore', 'node_modules/\n');
    put(repo, 'node_modules/foo/index.js', 'module.exports = 1;\n');
    const file = path.join(repo, 'node_modules/foo/index.js');
    const wholeSecond = Math.floor(Date.now() / 1000) - 3600;
    fs.utimesSync(file, wholeSecond, wholeSecond);
    const before = await start(repo);

    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.writeFileSync(file, 'module.exports = 2;\n');
    fs.utimesSync(file, wholeSecond, wholeSecond);

    expect(await stop(repo, before)).toEqual(['node_modules/foo/index.js']);
  });

  it('names a node_modules file replaced by a rename (new inode) with the same size and times', async () => {
    const repo = makeRepo();
    put(repo, '.gitignore', 'node_modules/\n');
    put(repo, 'node_modules/foo/index.js', 'module.exports = 1;\n');
    const file = path.join(repo, 'node_modules/foo/index.js');
    const wholeSecond = Math.floor(Date.now() / 1000) - 3600;
    fs.utimesSync(file, wholeSecond, wholeSecond);
    const before = await start(repo);

    put(repo, 'node_modules/foo/swap.tmp', 'module.exports = 3;\n');
    fs.utimesSync(path.join(repo, 'node_modules/foo/swap.tmp'), wholeSecond, wholeSecond);
    fs.renameSync(path.join(repo, 'node_modules/foo/swap.tmp'), file);

    expect(await stop(repo, before)).toEqual(['node_modules/foo/index.js']);
  });

  it('does not void a run for new ignored output (build output, user decision; a self-ignoring .gitignore is a recorded limit)', async () => {
    const repo = makeRepo();
    put(repo, '.gitignore', 'ignored.log\ndist/\n*.bak\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'ignores']);
    const before = await start(repo);

    put(repo, 'dist/bundle.js', 'x\n');
    put(repo, 'src/app.ts.bak', 'x\n');

    expect(await stop(repo, before)).toEqual([]);
  });

  it('does not name new ignored OSS run files', async () => {
    const repo = makeRepo();
    put(repo, '.gitignore', 'ignored.log\n.oss/logs/\n.oss/workflow-state.json\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'ignores']);
    const before = await start(repo);

    put(repo, '.oss/logs/x.log', 'x\n');
    put(repo, '.oss/workflow-state.json', '{}\n');

    expect(await stop(repo, before)).toEqual([]);
  });

  it('cannot be fooled by a filter program swapped during the run (filters are switched off for the check)', async () => {
    const repo = makeRepo();
    const tools = tempDir('oss-fp-filter-');
    put(tools, 'clean.sh', 'cat\n');
    put(tools, 'original.ts', 'export const a = 1;\n');
    git(repo, ['config', 'filter.x.clean', `sh ${path.join(tools, 'clean.sh')}`]);
    git(repo, ['config', 'filter.x.smudge', 'cat']);
    put(repo, '.git/info/attributes', '*.ts filter=x\n');
    const before = await start(repo);

    put(tools, 'clean.sh', `cat ${path.join(tools, 'original.ts')}\n`);
    put(repo, 'src/app.ts', 'export const a = 666;\n');

    expect(await stop(repo, before)).toEqual(['src/app.ts']);
  });

  it("writes no object into the repo's own object store", async () => {
    const repo = makeRepo();
    const objects = path.join(repo, '.git', 'objects');
    put(repo, 'new-at-start.txt', 'a new untracked file\n');
    const objectsBefore = filesUnder(objects);
    const before = await start(repo);

    put(repo, 'src/app.ts', 'export const a = 77;\n');
    put(repo, 'new-during-run.txt', 'another\n');
    const changed = await stop(repo, before);

    expect(changed).toEqual(['new-during-run.txt', 'src/app.ts']);
    expect(filesUnder(objects)).toEqual(objectsBefore);
  });

  it("names a change to the user's own git config files as (git) user config", async () => {
    const repo = makeRepo();
    const before = await start(repo);

    put(home, '.config/git/attributes', '*.ts filter=x\n');

    expect(await stop(repo, before)).toEqual(['(git) user config']);
  });

  it('never reads a FIFO in hooks or info/ (no hang) and names one added during the run', async () => {
    const repo = makeRepo();
    execFileSync('mkfifo', [path.join(repo, '.git/hooks/pre-push')]);
    const before = await start(repo);

    execFileSync('mkfifo', [path.join(repo, '.git/info/attributes')]);

    expect(await stop(repo, before)).toEqual(['(git) .git/info']);
  });

  it('fingerprints a big untracked file (over 8 MB) by its stat, not its content, and names its change', async () => {
    const repo = makeRepo();
    const big = path.join(repo, 'big.bin');
    fs.writeFileSync(big, Buffer.alloc(9 * 1024 * 1024, 1));
    const before = await start(repo);
    expect(git(repo, ['ls-tree', '-r', '--name-only', before.tree])).not.toContain('big.bin');

    fs.appendFileSync(big, 'x');
    put(repo, 'src/app.ts', 'export const a = 5;\n');

    expect(await stop(repo, before)).toEqual(['big.bin', 'src/app.ts']);
  });
});

describe('ship round 3: untracked files and symlinked dependency folders (R-266)', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('hashes untracked files without writing any object, even into its own private store', async () => {
    const repo = makeRepo();
    put(repo, 'untracked-at-start.txt', 'unique content 8f2b1c\n');
    const blob = git(repo, ['hash-object', 'untracked-at-start.txt']).trim();
    const before = await start(repo);

    put(repo, 'untracked-at-start.txt', 'unique content 8f2b1c, changed\n');
    const changed = await stop(repo, before);

    expect(changed).toEqual(['untracked-at-start.txt']);
    expect(filesUnder(runDir).some((file) => file.endsWith(`${blob.slice(0, 2)}/${blob.slice(2)}`))).toBe(false);
  });

  it('records an untracked symlink by its target and never reads an untracked FIFO', async () => {
    const repo = makeRepo();
    fs.symlinkSync('src', path.join(repo, 'link-to-dir'));
    execFileSync('mkfifo', [path.join(repo, 'a-fifo')]);
    const before = await start(repo);

    fs.rmSync(path.join(repo, 'link-to-dir'));
    fs.symlinkSync('src/app.ts', path.join(repo, 'link-to-dir'));

    expect(await stop(repo, before)).toEqual(['link-to-dir']);
  });

  it('walks a symlinked node_modules at its real path and names changes under the link', async () => {
    const repo = makeRepo();
    const store = tempDir('oss-fp-store-');
    put(store, 'foo/index.js', 'module.exports = 1;\n');
    put(repo, '.gitignore', 'ignored.log\nnode_modules\n');
    fs.symlinkSync(store, path.join(repo, 'node_modules'));
    const before = await start(repo);

    put(store, 'foo/index.js', 'module.exports = 2; // patched in the store\n');

    expect(await stop(repo, before)).toEqual(['node_modules/foo/index.js']);
  });

  it('fails (the run becomes unverified) when a symlinked node_modules cannot be resolved', async () => {
    const repo = makeRepo();
    put(repo, '.gitignore', 'ignored.log\nnode_modules\n');
    fs.symlinkSync(path.join(repo, 'nowhere'), path.join(repo, 'node_modules'));
    runDir = tempDir('oss-fp-run-');
    home = tempDir('oss-fp-home-');

    await expect(printRepo(repo, ctx())).rejects.toThrow();
  });
});
