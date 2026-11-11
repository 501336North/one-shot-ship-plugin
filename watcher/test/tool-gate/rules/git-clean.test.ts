/**
 * @behavior The tool gate refuses a `git clean` only when it would really delete an untracked
 *   protected file (the gate's rules or state, the workflow state …). It asks git what the clean
 *   would remove (a dry run with the same options and pathspecs), so `-x`, `-X`, `-d`, `-e` and
 *   pathspecs count exactly as git counts them. A dry run (`-n`) deletes nothing and is allowed.
 *   When git can't answer, or the clean runs somewhere the gate can't follow or with settings it
 *   can't check, the gate falls back to refusing any clean that can reach a protected folder.
 * @business-rule US-006: an agent can't delete the gate's rules or state with `git clean`, but an
 *   ordinary clean of build output is not refused.
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCommand } from '../../../src/tool-gate/command-reader.js';
import type { GitReader } from '../../../src/tool-gate/git-reader.js';
import type { PathResolver } from '../../../src/tool-gate/path-resolver.js';
import { loadSettings, type GateSettings } from '../../../src/tool-gate/rule-file.js';
import { checkGitClean } from '../../../src/tool-gate/rules/git-clean.js';
import type { TreeFinder } from '../../../src/tool-gate/tree-finder.js';

const ROOT = '/work/repo';
const HOME = '/home/dev';
const PLUGIN_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const SETTINGS: GateSettings = loadSettings(
  (p) => (p.startsWith(PLUGIN_ROOT) ? fs.readFileSync(p, 'utf8') : null),
  PLUGIN_ROOT,
  ROOT,
).settings;

const NO_LINKS: PathResolver = { realpath: (p) => p };

/** A git that answers a dry run with `removed` (null: git could not tell). */
function gitThatWouldClean(removed: string[] | null) {
  const wouldClean = vi.fn(async (_dir: string, _options: string[], _pathspecs: string[]) => removed);
  const git: GitReader = { currentBranch: async () => 'feat/x', wouldClean };
  return { git, wouldClean };
}

async function check(cmd: string, git: GitReader) {
  const facts = readCommand(cmd, ROOT, HOME);
  for (const part of facts.parts) {
    const refusal = await checkGitClean(part, SETTINGS, ROOT, HOME, NO_LINKS, git);
    if (refusal !== null) return refusal;
  }
  return null;
}

describe('git-clean rule: asks git what the clean would remove', () => {
  it.each([
    ['git clean -fdx', ['.oss/tool-gates/']],
    ['git clean -fd', ['.oss/workflow-state.json']],
    ['git clean -f -X', ['.oss/tool-gates.json']],
    ['git clean -fdx', ['.oss/']],
  ])('should refuse %s when git would remove %j', async (cmd, removed) => {
    const { git } = gitThatWouldClean(removed);
    const refusal = await check(cmd, git);
    expect(refusal?.rule).toBe('protected-path');
    expect(refusal?.reason).toContain(removed[0].replace(/\/$/, ''));
  });

  it.each(['git clean -fdx', 'git clean -fd', 'git clean -f'])('should allow %s when git would remove only build output', async (cmd) => {
    const { git } = gitThatWouldClean(['build/', 'notes.tmp', '.oss/dev/active/x/']);
    expect(await check(cmd, git)).toBeNull();
  });

  it('should pass the options that choose files, and the pathspecs, to the dry run', async () => {
    const { git, wouldClean } = gitThatWouldClean([]);
    await check('git clean -fdx -e keep --exclude=also -- src docs', git);
    expect(wouldClean).toHaveBeenCalledWith(ROOT, ['-d', '-x', '-e', 'keep', '--exclude=also'], ['src', 'docs']);
  });

  it('should ask in the folder the clean runs in', async () => {
    const { git, wouldClean } = gitThatWouldClean([]);
    await check('cd build && git clean -fX', git);
    expect(wouldClean).toHaveBeenCalledWith(`${ROOT}/build`, ['-X'], []);
  });

  it('should read the paths git prints from that folder', async () => {
    const { git } = gitThatWouldClean(['../.oss/tool-gates.json']);
    expect((await check('cd build && git clean -f', git))?.rule).toBe('protected-path');
  });

  it.each(['git clean -n', 'git clean --dry-run -fdx', 'git clean -fdxn', 'git status'])('should allow %s without asking git', async (cmd) => {
    const { git, wouldClean } = gitThatWouldClean(['.oss/tool-gates/']);
    expect(await check(cmd, git)).toBeNull();
    expect(wouldClean).not.toHaveBeenCalled();
  });
});

describe('git-clean rule: when git can not answer, any clean that can reach a protected folder is refused', () => {
  it.each(['git clean -fdx', 'git clean -fdx .', 'cd .oss && git clean -f'])('should refuse %s when git gives no answer', async (cmd) => {
    const { git } = gitThatWouldClean(null);
    expect((await check(cmd, git))?.rule).toBe('protected-path');
  });

  it.each(['git clean -fdx build/', 'cd build && git clean -fdx'])('should allow %s when git gives no answer', async (cmd) => {
    const { git } = gitThatWouldClean(null);
    expect(await check(cmd, git)).toBeNull();
  });

  it.each([
    'git clean -fd --unknown-option',
    'git -c core.fsmonitor=x clean -fd',
    'GIT_DIR=/tmp/x git clean -fd',
    'git --work-tree=/tmp clean -fd',
  ])('should not ask git about %s, and refuse it at the repo root', async (cmd) => {
    const { git, wouldClean } = gitThatWouldClean([]);
    expect((await check(cmd, git))?.rule).toBe('protected-path');
    expect(wouldClean).not.toHaveBeenCalled();
  });

  it('should refuse a clean after a cd the gate can not follow, without asking git', async () => {
    const { git, wouldClean } = gitThatWouldClean([]);
    expect((await check('cd "$D" && git clean -fd', git))?.rule).toBe('protected-path');
    expect(wouldClean).not.toHaveBeenCalled();
  });
});

describe('git-clean rule: a clean holding a word only known when it runs (fix round 4, K1)', () => {
  it.each(['git clean -fdx $D', 'git clean -f "$X"', 'git clean -fdx src/$X', 'git clean -fdx -e $X', 'cd build && git clean -fd -- $X'])(
    'should refuse %s without asking git, since the unknown word could reach the repo root',
    async (cmd) => {
      const { git, wouldClean } = gitThatWouldClean([]);
      expect((await check(cmd, git))?.rule).toBe('protected-path');
      expect(wouldClean).not.toHaveBeenCalled();
    },
  );

  it.each(['cd build && git clean -fdx -e $X', 'git clean -fdx -e "$X" -- build/'])(
    'should allow %s without asking git, since an unknown exclude only keeps files and the folder holds nothing protected',
    async (cmd) => {
      const { git, wouldClean } = gitThatWouldClean([]);
      expect(await check(cmd, git)).toBeNull();
      expect(wouldClean).not.toHaveBeenCalled();
    },
  );
});

describe('git-clean rule: forms the dry run read wrongly (fix round 4, K2)', () => {
  /** Checks each part with the parts before it, and `isRepo` saying which folders hold a repo. */
  async function checkCall(cmd: string, git: GitReader, isRepo: (dir: string) => boolean = () => false) {
    const facts = readCommand(cmd, ROOT, HOME);
    for (const [index, part] of facts.parts.entries()) {
      const refusal = await checkGitClean(part, SETTINGS, ROOT, HOME, NO_LINKS, git, false, undefined, { earlier: facts.parts, count: index, isRepo });
      if (refusal !== null) return refusal;
    }
    return null;
  }

  it.each(['git clean -fdx -n --no-dry-run', 'git clean -n -fdx --no-dry-run'])('should read %s as a real clean, and ask git', async (cmd) => {
    const { git, wouldClean } = gitThatWouldClean(['.oss/tool-gates/']);
    expect((await checkCall(cmd, git))?.rule).toBe('protected-path');
    expect(wouldClean).toHaveBeenCalled();
  });

  it('should read git clean -fdx --no-dry-run -n as a dry run', async () => {
    const { git, wouldClean } = gitThatWouldClean(['.oss/tool-gates/']);
    expect(await checkCall('git clean -fdx --no-dry-run -n', git)).toBeNull();
    expect(wouldClean).not.toHaveBeenCalled();
  });

  it('should keep a doubled -f in the dry run, so git lists the nested repos it would remove', async () => {
    const { git, wouldClean } = gitThatWouldClean([]);
    await checkCall('git clean -ffdx', git);
    expect(wouldClean).toHaveBeenCalledWith(ROOT, ['-f', '-f', '-d', '-x'], []);
  });

  it('should refuse a clean git says would remove a nested repo (its .git/config is protected)', async () => {
    const { git } = gitThatWouldClean(['nested/']);
    expect((await checkCall('git clean -ffdx', git, (dir) => dir === `${ROOT}/nested`))?.rule).toBe('protected-path');
  });

  it.each([
    'git rm -r -q --cached . && git clean -fdx',
    'git reset -q && git clean -fdx',
    'git read-tree --empty; git clean -fdx',
    'git update-index --force-remove x && git clean -fd',
    'git stash -u && git clean -fdx',
    'git checkout --orphan x && git clean -fdx',
    'echo build >> .gitignore && git clean -fdX',
    'rm .gitignore && git clean -fd',
  ])('should not trust a dry run for %s, whose earlier part can change what is tracked or ignored', async (cmd) => {
    const { git, wouldClean } = gitThatWouldClean([]);
    expect((await checkCall(cmd, git))?.rule).toBe('protected-path');
    expect(wouldClean).not.toHaveBeenCalled();
  });

  it.each(['git status && git clean -fdx', 'npm run build && git clean -fdx', 'git diff; git log -1 && git clean -fd'])(
    'should still ask git for %s',
    async (cmd) => {
      const { git, wouldClean } = gitThatWouldClean([]);
      expect(await checkCall(cmd, git)).toBeNull();
      expect(wouldClean).toHaveBeenCalled();
    },
  );
});

describe('git-clean rule: pathspec magic and wildcards when git gives no answer (fix round 4, K2)', () => {
  it.each([
    "git clean -fdx ':(glob).o*'",
    "git clean -fdx ':(icase).OSS'",
    "git clean -fd ':/'",
    "cd build && git clean -fd ':/'",
    "cd build && git clean -fd ':!x'",
    "git clean -fd ':^build'",
    "git clean -fdx '.o*'",
    "git clean -fdx '.oss/tool-gate?'",
    'cd build && git clean -f --pathspec-from-file=list',
  ])('should refuse %s', async (cmd) => {
    const { git } = gitThatWouldClean(null);
    expect((await check(cmd, git))?.rule).toBe('protected-path');
  });

  it.each(["git clean -fdx 'build/*.o'", 'git clean -fd build/', "cd build && git clean -fdx '*.o'"])('should allow %s', async (cmd) => {
    const { git } = gitThatWouldClean(null);
    expect(await check(cmd, git)).toBeNull();
  });
});

describe('git-clean rule: -ff over a folder holding a nested repository deeper down (fix part K11, item 8)', () => {
  /** A tree finder that knows these paths hold a nested `.git` below them. */
  function treeWith(nested: Record<string, string>): TreeFinder {
    return { namedBelow: (dir, wanted) => (dir in nested && wanted('.git') ? [nested[dir]] : []) };
  }

  async function checkWith(cmd: string, git: GitReader, tree: TreeFinder) {
    const facts = readCommand(cmd, ROOT, HOME);
    for (const [index, part] of facts.parts.entries()) {
      const refusal = await checkGitClean(part, SETTINGS, ROOT, HOME, NO_LINKS, git, false, undefined, { earlier: facts.parts, count: index, tree });
      if (refusal !== null) return refusal;
    }
    return null;
  }

  const tree = treeWith({ [`${ROOT}/t7`]: `${ROOT}/t7/sub/.git` });

  it.each(['git clean -ffd', 'git clean -f -f -d', 'git clean --force --force -d', 'git clean --forc --f -d', 'git clean -dff t7'])(
    'should refuse %s when git lists t7/ and a repo lies below it',
    async (cmd) => {
      const { git } = gitThatWouldClean(['t7/']);
      const refusal = await checkWith(cmd, git, tree);
      expect(refusal?.rule).toBe('protected-path');
      expect(refusal?.reason).toContain('t7');
    },
  );

  it('should pass a doubled --force (or a prefix of it) to the dry run as -f -f', async () => {
    const { git, wouldClean } = gitThatWouldClean([]);
    await checkWith('git clean --fo --force -d', git, tree);
    expect(wouldClean).toHaveBeenCalledWith(ROOT, ['-f', '-f', '-d'], []);
  });

  it.each([
    ['git clean -fd', ['t7/']],
    ['git clean -ffd', ['build/']],
    ['git clean -ffd --no-force -f', ['t7/']],
  ])('should still allow %s when git lists %j', async (cmd, removed) => {
    const { git } = gitThatWouldClean(removed);
    expect(await checkWith(cmd, git, tree)).toBeNull();
  });

  it.each(['GIT_WORK_TREE=. git clean -ffd t7', 'git clean -ffd --new-option t7'])(
    'should refuse %s, which the gate can not ask git about, when a repo lies below t7',
    async (cmd) => {
      const { git } = gitThatWouldClean([]);
      expect((await checkWith(cmd, git, tree))?.rule).toBe('protected-path');
    },
  );

  it('should still allow GIT_WORK_TREE=. git clean -fd t7 (a single -f keeps nested repos)', async () => {
    const { git } = gitThatWouldClean([]);
    expect(await checkWith('GIT_WORK_TREE=. git clean -fd t7', git, tree)).toBeNull();
  });

  it('should read --dry-run in a prefix as a dry run', async () => {
    const { git, wouldClean } = gitThatWouldClean(['t7/']);
    expect(await checkWith('git clean -ffd --dry', git, tree)).toBeNull();
    expect(wouldClean).not.toHaveBeenCalled();
  });
});

describe('git-clean rule: -ff run from a subfolder, where git lists ./name with no trailing slash (fix part K12, item 3)', () => {
  const tree: TreeFinder = { namedBelow: (dir, wanted) => (dir === `${ROOT}/t7/sub` && wanted('.git') ? [`${ROOT}/t7/sub/n/.git`] : []) };
  /** The fs reader: which listed paths are real folders on disk. */
  const folders = new Set([`${ROOT}/t7/sub`, `${ROOT}/t7/build`]);

  async function checkFrom(cmd: string, git: GitReader, isRepo: (dir: string) => boolean = () => false) {
    const facts = readCommand(cmd, ROOT, HOME);
    for (const [index, part] of facts.parts.entries()) {
      const refusal = await checkGitClean(part, SETTINGS, ROOT, HOME, NO_LINKS, git, false, undefined, {
        earlier: facts.parts, count: index, isRepo, tree, isFolder: (p) => folders.has(p),
      });
      if (refusal !== null) return refusal;
    }
    return null;
  }

  it.each(['cd t7 && git clean -ffd', 'git -C t7 clean -ffd'])('should refuse %s when git lists ./sub and a repo lies below it', async (cmd) => {
    const { git } = gitThatWouldClean(['./sub']);
    expect((await checkFrom(cmd, git))?.reason).toContain('t7/sub');
  });

  it('should refuse cd t7 && git clean -ffd when the folder git lists as ./sub is itself a repo', async () => {
    const { git } = gitThatWouldClean(['./sub']);
    expect((await checkFrom('cd t7 && git clean -ffd', git, (dir) => dir === `${ROOT}/t7/sub`))?.rule).toBe('protected-path');
  });

  it.each([
    ['cd t7 && git clean -ffd', ['./build']],
    ['cd t7 && git clean -ffd', ['./notes.txt']],
    ['cd t7 && git clean -fd', ['./sub']],
  ])('should still allow %s when git lists %j', async (cmd, removed) => {
    const { git } = gitThatWouldClean(removed);
    expect(await checkFrom(cmd, git)).toBeNull();
  });
});
