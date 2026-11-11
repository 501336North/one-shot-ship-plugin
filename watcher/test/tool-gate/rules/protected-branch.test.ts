/**
 * @behavior The tool gate refuses an agent's `git commit` or `git push` made while the
 *   directory it runs in is on a protected branch, and refuses a push whose destination is a
 *   protected branch from any branch (`origin HEAD:main`, `origin :main`, `--all`, `--mirror`).
 * @business-rule IRON LAW #4: agents never commit or push to a protected branch. Quoted text
 *   is not a command, a detached HEAD is not a protected branch, and the branch list comes
 *   only from the settings.
 */

import { describe, it, expect, vi } from 'vitest';
import { readCommand, type CommandPart } from '../../../src/tool-gate/command-reader.js';
import type { GateSettings } from '../../../src/tool-gate/rule-file.js';
import type { GitReader } from '../../../src/tool-gate/git-reader.js';
import { checkBranchRefs, checkBranchSwitch, checkHistoryMove, checkProtectedBranch, checkRepoTrust, trustForCall } from '../../../src/tool-gate/rules/protected-branch.js';
import { OverBudget } from '../../../src/tool-gate/budget.js';

const CWD = '/work/repo';
const HOME = '/home/dev';

const SETTINGS: GateSettings = {
  version: 1,
  protectedBranches: ['main', 'master'],
  testFilePatterns: [],
  testCommandPatterns: [],
  sourceExtensions: [],
  protectedPaths: [],
  productionHosts: [],
  tagsAllowed: true,
};

/** A git reader where each directory is on the given branch (null = detached or not a repo). */
function gitOn(branches: Record<string, string | null>): GitReader & { currentBranch: ReturnType<typeof vi.fn> } {
  return { currentBranch: vi.fn(async (dir: string) => branches[dir] ?? null) };
}

function partsOf(cmd: string): CommandPart[] {
  const result = readCommand(cmd, CWD, HOME);
  if ('unreadable' in result) throw new Error(`expected a readable command: ${result.reason}`);
  return result.parts;
}

async function check(cmd: string, git: GitReader, settings: GateSettings = SETTINGS) {
  for (const part of partsOf(cmd)) {
    const refusal = await checkProtectedBranch(part, settings, git);
    if (refusal !== null) return refusal;
  }
  return null;
}

describe('protected-branch rule: committing or pushing while on a protected branch', () => {
  it.each(['git push', 'git commit -m "wip"', 'git push origin feature/x'])(
    'should refuse %s when the directory is on main, naming the branch and the command',
    async (cmd) => {
      const refusal = await check(cmd, gitOn({ [CWD]: 'main' }));
      expect(refusal).not.toBeNull();
      expect(refusal?.rule).toBe('protected-branch');
      expect(refusal?.reason).toMatch(/^Refused: /);
      expect(refusal?.reason).toContain('main');
      expect(refusal?.reason).toContain(cmd.startsWith('git push') ? 'git push' : 'git commit');
    },
  );

  it('should refuse on master too', async () => {
    expect((await check('git commit', gitOn({ [CWD]: 'master' })))?.reason).toContain('master');
  });

  it.each(['git push', 'git commit -m "wip"', 'git push origin feature/x'])(
    'should allow %s on a feature branch',
    async (cmd) => {
      expect(await check(cmd, gitOn({ [CWD]: 'feature/x' }))).toBeNull();
    },
  );

  it.each(['cd sub && git push', 'git -C sub push'])(
    'should use the branch of the directory the command really runs in: %s',
    async (cmd) => {
      const git = gitOn({ [CWD]: 'feature/x', [`${CWD}/sub`]: 'main' });
      expect((await check(cmd, git))?.reason).toContain('main');
      expect(git.currentBranch).toHaveBeenCalledWith(`${CWD}/sub`);
    },
  );

  it('should allow pushing from a feature-branch subfolder while the outer folder is on main', async () => {
    expect(await check('git -C sub push', gitOn({ [CWD]: 'main', [`${CWD}/sub`]: 'feature/x' }))).toBeNull();
  });

  it('should allow a commit whose message mentions pushing to main on a feature branch', async () => {
    expect(await check('git commit -m "stop push to main"', gitOn({ [CWD]: 'feature/x' }))).toBeNull();
  });
});

describe('protected-branch rule: pushing to a protected branch from anywhere', () => {
  it.each([
    'git push origin HEAD:main',
    'git push origin x:refs/heads/main',
    'git push origin :main',
    'git push origin main',
    'git push origin +x:main',
    'git push origin feature/x refs/heads/main',
    'git push --all',
    'git push --mirror',
    'git push origin --all',
    'git push --delete origin main',
    'git push -u origin HEAD:main',
    'git push -o ci.skip origin HEAD:main',
    'git push --push-option ci.skip origin main',
    'git push --receive-pack git-receive-pack origin main',
    'git push --exec git-receive-pack origin main',
    'git push --repo origin origin main',
    'git push origin HEAD:heads/main',
    'git push origin heads/main',
    'git push origin +refs/heads/main',
    'git push origin +HEAD:heads/main',
  ])('should refuse %s from a feature branch', async (cmd) => {
    const refusal = await check(cmd, gitOn({ [CWD]: 'feature/x' }));
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toMatch(/^Refused: /);
    expect(refusal?.reason).toContain('main');
    expect(refusal?.reason).toContain('git push');
  });

  it.each([
    'git push origin HEAD:feature/x',
    'git push origin mainline',
    'git push origin x:refs/heads/main-backup',
    'git push -o main origin feature/x',
    'git push --push-option main origin feature/x',
    'git push --repo main origin feature/x',
    'git push main',
  ])('should allow %s, which does not push to a protected branch', async (cmd) => {
    expect(await check(cmd, gitOn({ [CWD]: 'feature/x' }))).toBeNull();
  });

  it('should allow a plain push from a feature branch whose upstream may be main', async () => {
    expect(await check('git push', gitOn({ [CWD]: 'feature/x' }))).toBeNull();
  });
});

describe('protected-branch rule: shortened and alias options', () => {
  it.each([
    ['git push --mir', '--mirror'],
    ['git push --branches', '--branches'],
    ['git push --bra', '--branches'],
    ['git push --al', '--all'],
  ])('should refuse %s, which pushes every branch, naming %s', async (cmd, full) => {
    const refusal = await check(cmd, gitOn({ [CWD]: 'feature/x' }));
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toContain(`\`git push ${full}\``);
  });

  it('should refuse git push --del origin main from a feature branch', async () => {
    const refusal = await check('git push --del origin main', gitOn({ [CWD]: 'feature/x' }));
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toContain('main');
  });

  it('should allow git push --push-opt main origin feature/x, where main is only the option value', async () => {
    expect(await check('git push --push-opt main origin feature/x', gitOn({ [CWD]: 'feature/x' }))).toBeNull();
  });
});

describe('protected-branch rule: detached HEAD, other commands and settings', () => {
  it('should allow a commit on a detached HEAD', async () => {
    expect(await check('git commit -m "wip"', gitOn({ [CWD]: null }))).toBeNull();
  });

  it('should still refuse a push to main from a detached HEAD', async () => {
    expect((await check('git push origin HEAD:main', gitOn({ [CWD]: null })))?.reason).toContain('main');
  });

  it('should not apply to a command that is not git', async () => {
    const git = gitOn({ [CWD]: 'main' });
    expect(await check('echo git push', git)).toBeNull();
    expect(git.currentBranch).not.toHaveBeenCalled();
  });

  it('should not apply to other git commands, even on main', async () => {
    const git = gitOn({ [CWD]: 'main' });
    expect(await check('git status', git)).toBeNull();
    expect(await check('git log --oneline main', git)).toBeNull();
  });

  it('should take the protected branches only from the settings', async () => {
    const settings: GateSettings = { ...SETTINGS, protectedBranches: ['release'] };
    expect(await check('git push', gitOn({ [CWD]: 'main' }), settings)).toBeNull();
    expect((await check('git commit', gitOn({ [CWD]: 'release' }), settings))?.reason).toContain('release');
    expect((await check('git push origin HEAD:release', gitOn({ [CWD]: 'feature/x' }), settings))?.reason).toContain(
      'release',
    );
    expect(await check('git push origin HEAD:main', gitOn({ [CWD]: 'feature/x' }), settings)).toBeNull();
  });
});

describe('protected-branch rule: wildcard refspecs', () => {
  it.each([
    "git push origin 'refs/heads/*:refs/heads/*'",
    "git push origin '*:*'",
    "git push origin 'refs/heads/m*:refs/heads/m*'",
    "git push origin '+refs/*:refs/*'",
    "git push origin 'refs/heads/*'",
  ])('should refuse %s from a feature branch, since the wildcard can name a protected branch', async (cmd) => {
    expect((await check(cmd, gitOn({ [CWD]: 'feature/x' })))?.rule).toBe('protected-branch');
  });

  it.each(["git push origin 'refs/heads/feat/*:refs/heads/feat/*'", "git push origin 'refs/tags/*:refs/tags/*'"])(
    'should allow %s, whose wildcard cannot name a protected branch',
    async (cmd) => {
      expect(await check(cmd, gitOn({ [CWD]: 'feature/x' }))).toBeNull();
    },
  );
});

describe('protected-branch rule: a branch the same command created first (R2c)', () => {
  it('should check the new branch instead of the one the folder is on', async () => {
    const git = gitOn({ [CWD]: 'main' });
    const [part] = partsOf('git push -u origin feat/y');
    expect(await checkProtectedBranch(part, SETTINGS, git, 'feat/y')).toBeNull();
    expect(git.currentBranch).not.toHaveBeenCalled();
  });

  it('should refuse a commit or push on a new branch named like a protected one', async () => {
    const [part] = partsOf('git commit -m x');
    expect((await checkProtectedBranch(part, SETTINGS, gitOn({ [CWD]: 'feat/x' }), 'main'))?.reason).toContain('main');
  });
});

describe('protected-branch rule: a switch to a protected branch earlier in the same call (fix round 4, K2)', () => {
  /** The refusal for the commit or push of the call, given what ran before it. */
  const switched = (cmd: string) => {
    const parts = partsOf(cmd);
    const index = parts.findIndex((p) => p.git?.subcommand === 'commit' || p.git?.subcommand === 'push');
    return checkBranchSwitch(parts[index], parts, index, SETTINGS);
  };

  it.each([
    'git checkout main && git commit -m x',
    'git switch main && git commit -m x',
    'git checkout -q main && git commit -m x',
    'git checkout - && git commit -m x',
    'git checkout @{-1} && git commit -m x',
    'git switch "$B" && git commit -m x',
    'git checkout -B main && git commit -m x',
    'git switch --orphan master && git commit -m x',
    'git checkout --track origin/main && git push origin feat/x',
    'git checkout refs/heads/main && git commit -m x',
    'git symbolic-ref HEAD refs/heads/main && git commit -m x',
    'git checkout main && cd src && git commit -m x',
  ])('should refuse %s', (cmd) => {
    expect(switched(cmd)?.rule).toBe('protected-branch');
  });

  it.each([
    'git checkout feat/y && git commit -m x',
    'git checkout -- main.ts && git commit -m x',
    'git commit -m x',
    'git checkout -b feat/y && git commit -m x',
  ])('should allow %s', (cmd) => {
    expect(switched(cmd)).toBeNull();
  });
});

describe('protected-branch rule: moving, renaming or deleting a protected branch (fix round 4, K2)', () => {
  const refs = async (cmd: string, branch: string | null = 'feat/x') => checkBranchRefs(partsOf(cmd)[0], SETTINGS, gitOn({ [CWD]: branch }));

  it.each([
    'git update-ref refs/heads/main HEAD',
    'git update-ref -d refs/heads/master',
    'git update-ref -m msg refs/heads/main HEAD~1',
    'git update-ref --stdin',
    'git update-ref "$R" HEAD',
    'git branch -f main HEAD',
    'git branch --force main HEAD',
    'git branch -M feat/x main',
    'git branch -m main',
    'git branch -m main feat/old-main',
    'git branch -c feat/x main',
    'git branch -C main',
    'git branch -D main',
    'git branch -d master',
    'git branch --delete main',
    'git branch -df main',
    'git branch -D "$B"',
    'git symbolic-ref HEAD refs/heads/main',
    'git symbolic-ref refs/heads/feat/x refs/heads/main',
  ])('should refuse %s', async (cmd) => {
    expect((await refs(cmd))?.rule).toBe('protected-branch');
  });

  it.each([
    'git branch feat/y',
    'git branch -d feat-old',
    'git branch -D feat-old feat-older',
    'git branch --contains main',
    'git branch --merged main',
    'git branch -a',
    'git branch',
    'git branch -m feat/y',
    'git update-ref refs/heads/feat/y HEAD',
    'git update-ref refs/tags/main HEAD',
    'git symbolic-ref HEAD',
    'git symbolic-ref --short HEAD',
    'git symbolic-ref HEAD refs/heads/feat/y',
  ])('should allow %s', async (cmd) => {
    expect(await refs(cmd)).toBeNull();
  });

  it('should refuse git update-ref HEAD while on a protected branch, and allow it on a feature branch', async () => {
    expect((await refs('git update-ref HEAD HEAD~1', 'main'))?.reason).toContain('main');
    expect(await refs('git update-ref HEAD HEAD~1', 'feat/x')).toBeNull();
    expect(await refs('git update-ref --no-deref HEAD HEAD~1', 'main')).toBeNull();
  });
});

describe('protected-branch rule: a commit or push in a repository the gate cannot vouch for (fix round 4, K2)', () => {
  const trust = (answer: ReturnType<Parameters<typeof checkRepoTrust>[1]>) => vi.fn(() => answer);

  it.each(['git commit -m x', 'git push', 'git -C sub push origin feat'])('should refuse %s in a planted repository', (cmd) => {
    const trustOf = trust({ untrusted: 'sub/.git points at a git folder outside a .git folder' });
    const refusal = checkRepoTrust(partsOf(cmd)[0], trustOf);
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toContain('sub/.git');
  });

  it('should ask about the folder git runs in', () => {
    const trustOf = trust('trusted');
    checkRepoTrust(partsOf('git -C sub push')[0], trustOf);
    expect(trustOf).toHaveBeenCalledWith(`${CWD}/sub`);
  });

  it.each([['trusted' as const], ['none' as const]])('should allow a commit when the repository is %s', (answer) => {
    expect(checkRepoTrust(partsOf('git commit -m x')[0], trust(answer))).toBeNull();
  });

  it('should not ask for other git commands', () => {
    const trustOf = trust({ untrusted: 'x' });
    expect(checkRepoTrust(partsOf('git status')[0], trustOf)).toBeNull();
    expect(trustOf).not.toHaveBeenCalled();
  });
});

describe('protected-branch rule: commands that move history on a protected branch (fix round 4, K3)', () => {
  /** Only `a.txt` exists on disk in the folder git runs in. */
  const exists = (p: string) => p === `${CWD}/a.txt`;
  const move = async (cmd: string, branch: string | null) => {
    const parts = partsOf(cmd);
    return checkHistoryMove(parts[parts.length - 1], SETTINGS, gitOn({ [CWD]: branch }), null, exists);
  };

  it.each([
    'git merge feat/y',
    'git merge --no-commit feat/y',
    'git merge --continue',
    'git rebase feat/y',
    'git rebase --continue',
    'git rebase --skip',
    'git reset --hard HEAD~1',
    'git reset HEAD~1',
    'git reset --soft origin/main --',
    'git reset --keep abc123',
    'git cherry-pick abc123',
    'git cherry-pick --continue',
    'git revert HEAD',
    'git am x.patch',
    'git am --resolved',
    'git branch -m feat/z',
    'git branch -M feat/z',
    'git branch --move feat/z',
  ])('should refuse %s while on main, naming the branch', async (cmd) => {
    const refusal = await move(cmd, 'main');
    expect(refusal?.rule).toBe('protected-branch');
    expect(refusal?.reason).toContain('`main`');
  });

  it.each([
    'git pull',
    'git pull --rebase',
    'git fetch',
    'git reset',
    'git reset -q',
    'git reset HEAD',
    'git reset HEAD a.txt',
    'git reset -- a.txt',
    'git reset a.txt',
    "git reset 'src/*.ts'",
    'git reset --hard',
    'git reset --merge',
    'git reset -p',
    'git reset --pathspec-from-file=list.txt',
    'git merge --abort',
    'git merge --quit',
    'git rebase --abort',
    'git rebase --quit',
    'git rebase --edit-todo',
    'git cherry-pick --abort',
    'git cherry-pick -n abc123',
    'git revert --no-commit HEAD',
    'git revert --quit',
    'git am --abort',
    'git am --show-current-patch',
    'git branch -m feat/a feat/b',
    'git branch -c feat/z',
    'git status',
  ])('should allow %s while on main', async (cmd) => {
    expect(await move(cmd, 'main')).toBeNull();
  });

  it.each(['git merge main', 'git reset --hard HEAD~1', 'git branch -m feat/z'])('should allow %s on a feature branch or a detached HEAD', async (cmd) => {
    expect(await move(cmd, 'feat/x')).toBeNull();
    expect(await move(cmd, null)).toBeNull();
  });

  it('should check the branch an earlier part created instead of the folder\'s', async () => {
    const part = partsOf('git merge feat/y')[0];
    expect(await checkHistoryMove(part, SETTINGS, gitOn({ [CWD]: 'main' }), 'feat/new', exists)).toBeNull();
  });

  it('should refuse a history move in a folder the gate cannot follow', async () => {
    const parts = partsOf('cd "$X" && git reset --hard HEAD~1');
    const refusal = await checkHistoryMove(parts[1], SETTINGS, gitOn({}), null, exists);
    expect(refusal?.rule).toBe('protected-branch');
  });

  it.each(['git checkout main && git merge feat/x', 'git checkout - && git rebase x', 'git switch "$B" && git reset --hard HEAD~1', 'git checkout main && git branch -m feat/z'])(
    'should refuse %s: an earlier part may have switched to a protected branch',
    (cmd) => {
      const parts = partsOf(cmd);
      const refusal = checkBranchSwitch(parts[1], parts, 1, SETTINGS, exists);
      expect(refusal?.rule).toBe('protected-branch');
    },
  );

  it.each(['git checkout main && git pull', 'git checkout main && git reset a.txt', 'git checkout main && git merge --abort'])(
    'should allow %s',
    (cmd) => {
      const parts = partsOf(cmd);
      expect(checkBranchSwitch(parts[1], parts, 1, SETTINGS, exists)).toBeNull();
    },
  );
});

describe('protected-branch rule: vouching for repositories within one call (fix round 4, K8, item 4)', () => {
  it('asks about each folder once per call, however many parts commit there', () => {
    const trust = vi.fn(() => 'trusted' as const);
    const trustOf = trustForCall(trust);
    for (const part of partsOf('(cd a && git commit -m x); (cd a && git commit -m y); git push origin feat/x')) checkRepoTrust(part, trustOf);
    expect(trust.mock.calls.map(([dir]) => dir)).toEqual([`${CWD}/a`, CWD]);
  });

  it('refuses, as too complex (OverBudget), git in a folder path over 4096 characters', () => {
    const trust = vi.fn(() => 'trusted' as const);
    expect(() => trustForCall(trust)(`${CWD}/${'g'.repeat(4100)}`)).toThrow(OverBudget);
    expect(trust).not.toHaveBeenCalled();
  });

  it('refuses, as too complex (OverBudget), git in a folder over 512 folders deep', () => {
    expect(() => trustForCall(() => 'trusted')(`${CWD}/${Array.from({ length: 600 }, () => 'g').join('/')}`)).toThrow(OverBudget);
  });
});

describe('protected-branch rule: protected names in another letter case (fix round 4, K8, item 5)', () => {
  const lastPart = (cmd: string) => partsOf(cmd).at(-1)!;

  it.each(['git update-ref refs/heads/MAIN HEAD', 'git branch -f MAIN feat', 'git symbolic-ref HEAD refs/heads/Main'])(
    'should refuse %s where letter case does not matter',
    async (cmd) => {
      expect(await checkBranchRefs(lastPart(cmd), SETTINGS, gitOn({}), true)).not.toBeNull();
      expect(await checkBranchRefs(lastPart(cmd), SETTINGS, gitOn({}), false)).toBeNull();
    },
  );

  it('should refuse a commit while on MAIN, and a push to Main, where letter case does not matter', async () => {
    expect(await checkProtectedBranch(lastPart('git commit -m x'), SETTINGS, gitOn({ [CWD]: 'MAIN' }), null, true)).not.toBeNull();
    expect(await checkProtectedBranch(lastPart('git push origin HEAD:Main'), SETTINGS, gitOn({ [CWD]: 'feat' }), null, true)).not.toBeNull();
    expect(await checkProtectedBranch(lastPart('git commit -m x'), SETTINGS, gitOn({ [CWD]: 'MAIN' }), null, false)).toBeNull();
  });

  it('should refuse a commit after a symbolic-ref to MAIN, and a merge while on Master, where letter case does not matter', async () => {
    const parts = partsOf('git symbolic-ref HEAD refs/heads/MAIN && git commit -m x');
    expect(checkBranchSwitch(parts[1], parts, 1, SETTINGS, undefined, true)).not.toBeNull();
    expect(await checkHistoryMove(lastPart('git merge feat'), SETTINGS, gitOn({ [CWD]: 'Master' }), null, () => false, true)).not.toBeNull();
  });

  it('should still allow names that only start like a protected one', async () => {
    expect(await checkBranchRefs(lastPart('git branch -f mainline feat'), SETTINGS, gitOn({}), true)).toBeNull();
  });
});

describe('protected-branch rule: resetting or rewriting a protected branch (fix round 4, K8, item 6)', () => {
  const refs = (cmd: string) => checkBranchRefs(partsOf(cmd).at(-1)!, SETTINGS, gitOn({}), true);
  const move = (cmd: string, branch: string) => checkHistoryMove(partsOf(cmd).at(-1)!, SETTINGS, gitOn({ [CWD]: branch }), null, () => false, true);

  it.each([
    'git checkout -B main',
    'git checkout -Bmain',
    'git switch -C main',
    'git switch --force-create=main',
    'git fetch origin +x:main',
    'git fetch origin x:refs/heads/main',
    'git fetch -u origin x:main',
    'git fetch --depth 1 origin x:MAIN',
    'git fetch origin refs/heads/*:refs/heads/*',
  ])('should refuse %s from any branch', async (cmd) => {
    expect(await refs(cmd)).not.toBeNull();
  });

  it.each(['git fetch origin', 'git fetch origin main', 'git fetch origin main:refs/remotes/origin/main', 'git checkout -B feat/x', 'git switch -C feat/x'])(
    'should still allow %s',
    async (cmd) => {
      expect(await refs(cmd)).toBeNull();
    },
  );

  it.each(['git filter-branch -- main', 'git filter-branch --all', 'git filter-repo --path src', 'git filter-repo --refs main', 'git replace main x', 'git reflog delete main@{1}', 'git reflog expire --all'])(
    'should refuse %s from a feature branch, as it names a protected branch',
    async (cmd) => {
      expect(await move(cmd, 'feat')).not.toBeNull();
    },
  );

  it.each(['git filter-branch', 'git fast-import', 'git subtree merge --prefix=lib x', 'git subtree pull --prefix=lib origin x', 'git replace a b', 'git reflog expire HEAD'])(
    'should refuse %s while on main',
    async (cmd) => {
      expect(await move(cmd, 'main')).not.toBeNull();
    },
  );

  it.each(['git filter-branch -- feat', 'git filter-repo --refs feat', 'git fast-import', 'git replace a b', 'git reflog expire refs/heads/feat', 'git reflog show main'])(
    'should still allow %s from a feature branch',
    async (cmd) => {
      expect(await move(cmd, 'feat')).toBeNull();
    },
  );
});

describe('protected-branch rule: pulling into a protected branch (fix round 4, K8, item 7)', () => {
  /** Only the folder `other` exists on disk next to the repo. */
  const exists = (p: string) => p === `${CWD}/other`;
  const pull = (cmd: string, branch: string) => checkHistoryMove(partsOf(cmd).at(-1)!, SETTINGS, gitOn({ [CWD]: branch }), null, exists);

  it.each(['git pull . feat', 'git pull other main', 'git pull ./other main', 'git pull file:///x main', 'git pull origin feat', 'git pull origin feat:main', 'git pull origin +main', 'git pull origin main feat'])(
    'should refuse %s while on main',
    async (cmd) => {
      expect(await pull(cmd, 'main')).not.toBeNull();
    },
  );

  it.each(['git pull', 'git pull --ff-only', 'git pull --rebase', 'git pull origin', 'git pull origin main', 'git pull -X theirs origin main', 'git pull --depth 1 origin refs/heads/main'])(
    'should still allow %s while on main',
    async (cmd) => {
      expect(await pull(cmd, 'main')).toBeNull();
    },
  );

  it('should still allow any pull on a feature branch', async () => {
    expect(await pull('git pull . main', 'feat')).toBeNull();
  });

  it('should refuse pulling another branch after a checkout of main, and allow its own upstream', () => {
    const other = partsOf('git checkout main && git pull origin feat');
    const own = partsOf('git checkout main && git pull origin main');
    expect(checkBranchSwitch(other[1], other, 1, SETTINGS, () => false)).not.toBeNull();
    expect(checkBranchSwitch(own[1], own, 1, SETTINGS, () => false)).toBeNull();
  });
});

describe('protected-branch rule: force-creating a protected branch in any spelling (fix part K11, item 3)', () => {
  const refs = (cmd: string) => checkBranchRefs(partsOf(cmd).at(-1)!, SETTINGS, gitOn({}), true);

  it.each([
    'git checkout -qB main',
    'git checkout -fB main',
    'git checkout -qfB main',
    'git checkout -tB main origin/main',
    'git checkout -qBmain',
    'git switch -qC main',
    'git switch -fCmain',
    'git switch --force-c main',
    'git switch --force-cr=main',
    'git switch --force- main',
  ])('should refuse %s from any branch', async (cmd) => {
    expect(await refs(cmd)).not.toBeNull();
  });

  it.each(['git checkout -qB feat/x', 'git switch -fC feat/x', 'git checkout -bB', 'git checkout -qb main', 'git switch --force main', 'git checkout -U3 main'])(
    'should still allow %s',
    async (cmd) => {
      expect(await refs(cmd)).toBeNull();
    },
  );
});

describe('protected-branch rule: rebase or worktree that switches to a protected branch (fix part K11, item 7)', () => {
  const refs = (cmd: string) => checkBranchRefs(partsOf(cmd).at(-1)!, SETTINGS, gitOn({ [CWD]: 'feat' }), true);

  it.each([
    'git rebase feat main',
    'git rebase --onto feat x main',
    'git rebase --onto=feat x main',
    'git rebase --on feat x main',
    'git rebase -i --root main',
    'git rebase --ro main',
    'git rebase -x "npm test" feat main',
    'git rebase -ix "npm test" feat main',
    'git rebase -s ours -X theirs feat main',
    'git rebase feat Main',
    'git rebase feat heads/main',
    'git worktree add -B main ../w',
    'git worktree add -b main ../w',
    'git worktree add -qfBmain ../w',
    'git worktree add --reason x --lock -B main ../w',
  ])('should refuse %s from a feature branch', async (cmd) => {
    expect(await refs(cmd)).not.toBeNull();
  });

  it.each([
    'git rebase main',
    'git rebase main feat',
    'git rebase -i main',
    'git rebase --onto main x feat',
    'git rebase -x "npm test" main',
    'git rebase -s ours main',
    'git rebase --root feat',
    'git rebase --continue',
    'git worktree add -b feat/y ../w',
    'git worktree add ../w feat',
    'git worktree add ../main',
    'git worktree remove main',
  ])('should still allow %s', async (cmd) => {
    expect(await refs(cmd)).toBeNull();
  });
});

describe('protected-branch rule: a worktree lock reason is a note, not a branch (fix part K12, item 5a)', () => {
  const refs = (cmd: string) => checkBranchRefs(partsOf(cmd).at(-1)!, SETTINGS, gitOn({ [CWD]: 'feat' }), true);

  it.each(['git worktree add --reason main ../wt', 'git worktree add --lock --reason main ../wt feat', 'git worktree add --lock --reas=main ../wt'])(
    'should allow %s',
    async (cmd) => {
      expect(await refs(cmd)).toBeNull();
    },
  );

  it.each(['git worktree add --lock --reason main -B main ../wt', 'git worktree add --reason main -qb main ../wt'])('should refuse %s', async (cmd) => {
    expect(await refs(cmd)).not.toBeNull();
  });
});
