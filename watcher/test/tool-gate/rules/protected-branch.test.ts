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
import { checkProtectedBranch } from '../../../src/tool-gate/rules/protected-branch.js';

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
    expect(await check('git commit', gitOn({ [CWD]: 'master' }))?.reason).toContain('master');
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
      expect(await check(cmd, git)?.reason).toContain('main');
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
    expect(await check('git push origin HEAD:main', gitOn({ [CWD]: null }))?.reason).toContain('main');
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
    expect(await check('git commit', gitOn({ [CWD]: 'release' }), settings)?.reason).toContain('release');
    expect(await check('git push origin HEAD:release', gitOn({ [CWD]: 'feature/x' }), settings)?.reason).toContain(
      'release',
    );
    expect(await check('git push origin HEAD:main', gitOn({ [CWD]: 'feature/x' }), settings)).toBeNull();
  });
});
