/**
 * @behavior The tool gate decides, without listing the disk, whether a shell wildcard an agent
 *   wrote (`.oss/*`, `.os?`, `~/.claude/plugi*`, `.oss/tool-gate[s]`) could reach a protected
 *   path or a folder holding one, since the shell expands it to whatever matches when the
 *   command runs. As in bash and zsh, a wildcard at the start of a name never matches a leading
 *   `.`, so `dist/*` and `*` at the repo root don't reach `.oss`.
 * @business-rule US-006: a protected file can't be written or removed by spelling it as a
 *   wildcard. Ordinary wildcards (`rm -rf dist/*`, `git add src/*.ts`) stay allowed.
 */

import { describe, it, expect } from 'vitest';
import { shellGlobMayMatch, shellPatternMatchesPath, tailMayBeProtected } from '../../src/tool-gate/patterns.js';

const opts = { home: '/home/dev', root: '/work/repo' };
const PROTECTED = [
  '.oss/tool-gates.json', '.oss/tool-gates/**', '~/.claude/settings*.json', '~/.claude/plugins/**', '.oss/workflow-state.json',
];

function reaches(glob: string, exemptAnchor = false, caseInsensitive = false): boolean {
  return shellGlobMayMatch(glob, PROTECTED, { ...opts, caseInsensitive }, exemptAnchor);
}

describe('shellGlobMayMatch: a wildcard that could reach a protected path', () => {
  it.each([
    '/work/repo/.oss/workflow-state.jso?',
    '/work/repo/.oss/tool-gates.jso?',
    '/work/repo/.oss/*',
    '/work/repo/.os?',
    '/work/repo/.oss/tool-gate[s]',
    '/work/repo/.o*',
    '/work/repo/.o?s/tool-gates.json',
    '/home/dev/.claude/settings.js?n',
    '/home/dev/.claude/plugi*',
    '/home/dev/.claude/plugins/x/*',
    '/work/repo/.oss/[st]ool-gates.json',
  ])('should say %s could reach a protected path', (glob) => {
    expect(reaches(glob)).toBe(true);
  });

  it.each([
    '/work/repo/dist/*',
    '/work/repo/src/*.ts',
    '/work/repo/*',
    '/work/repo/?oss',
    '/work/repo/[.]oss',
    '/work/repo/.oss/dev/*',
    '/work/repo/.oss/tool-gates.jso\\?',
    '/tmp/*',
  ])('should say %s cannot reach a protected path', (glob) => {
    expect(reaches(glob)).toBe(false);
  });

  it('should match in any letter case on a case-insensitive file system only', () => {
    expect(reaches('/work/repo/.OSS/*', false, true)).toBe(true);
    expect(reaches('/work/repo/.OSS/*', false, false)).toBe(false);
  });

  it('should not count the repo root, home or their parents as holding protected paths when asked', () => {
    expect(reaches('/work/rep?', false)).toBe(true);
    expect(reaches('/work/rep?', true)).toBe(false);
    expect(reaches('/home/de?', true)).toBe(false);
    expect(reaches('/work/repo/.os?', true)).toBe(true);
  });

  it('should stay fast for a long wildcard word', () => {
    const start = Date.now();
    reaches(`/work/repo/${'*a'.repeat(1000)}`);
    reaches(`/work/repo/${'*/'.repeat(500)}x`);
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('shellGlobMayMatch: globs that match at any depth (**/…)', () => {
  const GIT_CONFIG = ['**/.git/config', '**/.git/worktrees/*/config.worktree'];
  const at = (glob: string): boolean => shellGlobMayMatch(glob, GIT_CONFIG, opts, true);

  it.each(['/work/repo/.gi?/config', '/work/repo/.git/conf*', '/other/.git/c*', '/work/repo/.git/worktrees/*/config.*'])(
    'should say %s could reach a git config file',
    (glob) => {
      expect(at(glob)).toBe(true);
    },
  );

  it.each(['/work/repo/dist/*', '/work/repo/*', '/tmp/*', '/work/repo/.gi?'])(
    'should say %s cannot: a folder above a file matched at any depth does not hold it',
    (glob) => {
      expect(at(glob)).toBe(false);
    },
  );
});

describe('shellGlobMayMatch: wildcards and dot entries (fix round 4, K2)', () => {
  const dotted = (glob: string): boolean => shellGlobMayMatch(glob, PROTECTED, opts, true, true);

  it.each(['/work/repo/*', '/work/repo/**/tool-gates.json', '/work/repo/**', '/home/dev/*/settings.json'])(
    'should say %s can reach a protected path once dot entries match (dotglob, GLOB_DOTS, (D))',
    (glob) => {
      expect(dotted(glob)).toBe(true);
    },
  );

  it.each(['/work/repo/**/tool-gates.json', '/work/repo/**/node_modules', '/work/repo/**/*.log', '/home/dev/**/settings.json'])(
    'should say %s cannot by default: like zsh and bash, ** does not go into dot folders',
    (glob) => {
      expect(reaches(glob, true)).toBe(false);
    },
  );

  it('should still say ** reaches a protected path through dot folders the pattern names', () => {
    expect(reaches('/work/repo/.oss/**', true)).toBe(true);
    expect(reaches('/work/repo/**/.oss/tool-gates.json', true)).toBe(true);
  });
});

describe('tailMayBeProtected: a relative path written after a cd the gate cannot follow (fix round 4, K2)', () => {
  const GLOBS = [...PROTECTED, '**/.git/config', '~/.oss/hooks/**'];
  const tail = (t: string): boolean => tailMayBeProtected(t, GLOBS, opts, false);

  it.each([
    '.oss/workflow-state.json',
    'workflow-state.json',
    'tool-gates.json',
    'tool-gates/cycle.json',
    '.claude/settings.json',
    'settings.local.json',
    '.git/config',
    'config',
    'hooks/oss-notify.sh',
    'workflow-state.jso?',
  ])('should say %s could end a protected path', (t) => {
    expect(tail(t)).toBe(true);
  });

  it.each(['out.txt', 'build/out.js', 'cycle.json', 'src/x.ts', 'notes/settings.md', '*.log'])(
    'should say %s names nothing a protected path is named by (a folder that holds any name aside)',
    (t) => {
      expect(tail(t)).toBe(false);
    },
  );
});

describe('tailMayBeProtected: wildcards and whole folders after a cd the gate cannot follow (fix round 4, K3)', () => {
  const GLOBS = [...PROTECTED, '**/.git'];
  const contents = (t: string, dots = false): boolean => tailMayBeProtected(t, GLOBS, opts, dots, true);

  it.each(['*.log', '?', '*', 'b*/x', 'build/**', '**'])('should say %s could cover a protected folder\'s contents', (t) => {
    expect(contents(t, true)).toBe(true);
  });

  it('should count a protected folder\'s contents only when asked', () => {
    expect(tailMayBeProtected('*.log', GLOBS, opts, false)).toBe(false);
    expect(contents('*.log')).toBe(true);
  });

  it('should read a tail that climbs with .. by what is left below the climb', () => {
    expect(tailMayBeProtected('../workflow-state.json', GLOBS, opts, false)).toBe(true);
    expect(tailMayBeProtected('../../tool-gates.json', GLOBS, opts, false)).toBe(true);
    expect(tailMayBeProtected('../out.txt', GLOBS, opts, false)).toBe(false);
  });

  it('should say a whole folder (its contents, dot entries included) could hold a nested .git', () => {
    expect(contents('build/**', true)).toBe(true);
    expect(tailMayBeProtected('build/**', ['.oss/tool-gates.json'], opts, true, true)).toBe(false);
  });
});

describe('shellPatternMatchesPath: whether the shell would expand a pattern to a path', () => {
  it.each([
    ['/r/*', '/r/build', false],
    ['/r/bui*', '/r/build', false],
    ['/r/*', '/r/.git', true],
    ['/r/b?ild/sub', '/r/build/sub', false],
    ['/r/[ab]uild', '/r/build', false],
  ])('should match %s against %s (dots: %s)', (pattern, p, dots) => {
    expect(shellPatternMatchesPath(pattern, p, {}, dots)).toBe(true);
  });

  it.each([
    ['/r/*', '/r/.git', false],
    ['/r/d*', '/r/build', false],
    ['/r/*', '/r/build/sub', false],
    ['/r/*.o', '/r/build', false],
  ])('should not match %s against %s (dots: %s)', (pattern, p, dots) => {
    expect(shellPatternMatchesPath(pattern, p, {}, dots)).toBe(false);
  });

  it('should ignore letter case when asked', () => {
    expect(shellPatternMatchesPath('/r/BUI*', '/r/build', { caseInsensitive: true }, false)).toBe(true);
  });
});
