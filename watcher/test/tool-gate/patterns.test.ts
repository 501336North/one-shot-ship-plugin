/**
 * @behavior The tool gate decides whether a file is a test file or a protected file, and
 *   whether a shell command is a test run, by matching it against the patterns in the rule
 *   file: path globs (`**\/*.test.*`, `~/.oss/hooks/**`, `.claude/settings*.json`) and
 *   command patterns (`npm run test*`, `bash *test*.sh`).
 * @business-rule A command pattern matches the command's leading words one by one, each as
 *   a whole word, so `jest` never matches `jester` and `make test` never matches
 *   `make testing`. Relative globs are anchored at the repo root, `~/` is the user's home,
 *   and `**\/` matches at any depth. Matching never touches the filesystem.
 */

import { describe, it, expect } from 'vitest';
import { matchPath, matchCommand } from '../../src/tool-gate/patterns.js';

const opts = { home: '/Users/dev', root: '/work/repo' };

function path(glob: string, absPath: string): boolean {
  return matchPath(glob, absPath, opts);
}

function cmd(pattern: string, command: string): boolean {
  return matchCommand(pattern, command.split(' '));
}

describe('matchPath: test file patterns that start with **/', () => {
  it('should match **/*.test.* against src/a/foo.test.ts and not foo.ts', () => {
    expect(path('**/*.test.*', '/work/repo/src/a/foo.test.ts')).toBe(true);
    expect(path('**/*.test.*', '/work/repo/foo.test.ts')).toBe(true);
    expect(path('**/*.test.*', '/work/repo/src/a/foo.ts')).toBe(false);
    expect(path('**/*.test.*', '/work/repo/foo.ts')).toBe(false);
  });

  it('should match **/__tests__/** at any depth', () => {
    expect(path('**/__tests__/**', '/work/repo/__tests__/a.ts')).toBe(true);
    expect(path('**/__tests__/**', '/work/repo/src/deep/__tests__/x/a.ts')).toBe(true);
    expect(path('**/__tests__/**', '/work/repo/src/a.ts')).toBe(false);
  });

  it('should match a file outside the repo by its trailing folders and name', () => {
    expect(path('**/*.test.*', '/anywhere/a/foo.test.ts')).toBe(true);
    expect(path('**/__tests__/**', '/anywhere/__tests__/a.ts')).toBe(true);
    expect(path('**/*.test.*', '/anywhere/a/foo.ts')).toBe(false);
  });

  it('should match shell and Go test file patterns by name', () => {
    expect(path('**/test_*.sh', '/work/repo/hooks/test_gate.sh')).toBe(true);
    expect(path('**/test_*.sh', '/work/repo/hooks/gate.sh')).toBe(false);
    expect(path('**/*_test.go', '/work/repo/pkg/x_test.go')).toBe(true);
    expect(path('**/*.spec.*', '/work/repo/src/a.spec.tsx')).toBe(true);
  });

  it('should cross dot-folders with **', () => {
    expect(path('**/*.test.*', '/work/repo/.hidden/a.test.ts')).toBe(true);
  });
});

describe('matchPath: home-relative globs', () => {
  it('should match ~/.oss/hooks/** after ~ expansion against an absolute path', () => {
    expect(path('~/.oss/hooks/**', '/Users/dev/.oss/hooks/pre.sh')).toBe(true);
    expect(path('~/.oss/hooks/**', '/Users/dev/.oss/hooks/sub/x.sh')).toBe(true);
    expect(path('~/.oss/hooks/**', '/Users/other/.oss/hooks/pre.sh')).toBe(false);
  });

  it('should not match the folder itself with a trailing /**', () => {
    expect(path('~/.oss/hooks/**', '/Users/dev/.oss/hooks')).toBe(false);
  });
});

describe('matchPath: globs relative to the repo root', () => {
  it('should anchor .oss/tool-gates.json at the repo root', () => {
    expect(path('.oss/tool-gates.json', '/work/repo/.oss/tool-gates.json')).toBe(true);
    expect(path('.oss/tool-gates.json', '/work/repo/sub/.oss/tool-gates.json')).toBe(false);
    expect(path('.oss/tool-gates.json', '/elsewhere/.oss/tool-gates.json')).toBe(false);
  });

  it('should match .claude/settings*.json for every settings file name', () => {
    expect(path('.claude/settings*.json', '/work/repo/.claude/settings.json')).toBe(true);
    expect(path('.claude/settings*.json', '/work/repo/.claude/settings.local.json')).toBe(true);
    expect(path('.claude/settings*.json', '/work/repo/.claude/other.json')).toBe(false);
  });

  it('should match everything under .oss/tool-gates/** but not the folder itself', () => {
    expect(path('.oss/tool-gates/**', '/work/repo/.oss/tool-gates/cycle.json')).toBe(true);
    expect(path('.oss/tool-gates/**', '/work/repo/.oss/tool-gates/a/b.json')).toBe(true);
    expect(path('.oss/tool-gates/**', '/work/repo/.oss/tool-gates')).toBe(false);
  });
});

describe('matchPath: glob rules', () => {
  it('should match an absolute glob as written', () => {
    expect(path('/etc/hosts', '/etc/hosts')).toBe(true);
    expect(path('/etc/*.conf', '/etc/a.conf')).toBe(true);
    expect(path('/etc/*.conf', '/etc/sub/a.conf')).toBe(false);
  });

  it('should let * match within one folder only', () => {
    expect(path('src/*.ts', '/work/repo/src/a.ts')).toBe(true);
    expect(path('src/*.ts', '/work/repo/src/sub/a.ts')).toBe(false);
  });

  it('should let ? match exactly one character', () => {
    expect(path('src/?.ts', '/work/repo/src/a.ts')).toBe(true);
    expect(path('src/?.ts', '/work/repo/src/ab.ts')).toBe(false);
  });

  it('should let ** in the middle match zero or more folders', () => {
    expect(path('src/**/a.ts', '/work/repo/src/a.ts')).toBe(true);
    expect(path('src/**/a.ts', '/work/repo/src/x/y/a.ts')).toBe(true);
  });

  it('should normalize .. and duplicate slashes on both sides', () => {
    expect(path('.oss/tool-gates.json', '/work/repo/src/../.oss//tool-gates.json')).toBe(true);
    expect(path('./.oss/tool-gates.json', '/work/repo/.oss/tool-gates.json')).toBe(true);
  });

  it('should be case-sensitive', () => {
    expect(path('.oss/tool-gates.json', '/work/repo/.OSS/tool-gates.json')).toBe(false);
  });

  it('should treat regex characters in a glob as plain text', () => {
    expect(path('src/a+b.ts', '/work/repo/src/a+b.ts')).toBe(true);
    expect(path('src/a.ts', '/work/repo/src/aXts')).toBe(false);
  });
});

describe('matchCommand', () => {
  it('should match command pattern "npm run test*" against "npm run test:unit"', () => {
    expect(cmd('npm run test*', 'npm run test:unit')).toBe(true);
    expect(cmd('npm run test*', 'npm run test')).toBe(true);
    expect(cmd('npm run test*', 'npm run lint')).toBe(false);
  });

  it('should match "bash *test*.sh" against "bash ./run-tests.sh"', () => {
    expect(cmd('bash *test*.sh', 'bash ./run-tests.sh')).toBe(true);
    expect(cmd('bash *test*.sh', 'bash ./deploy.sh')).toBe(false);
  });

  it('should not match "jest" against "jester"', () => {
    expect(cmd('jest', 'jester')).toBe(false);
    expect(cmd('jest', 'jest')).toBe(true);
  });

  it('should match when the command has more words after the pattern', () => {
    expect(cmd('npm test', 'npm test -- --run')).toBe(true);
    expect(cmd('npx vitest', 'npx vitest run x')).toBe(true);
  });

  it('should compare each word whole, so "make test" does not match "make testing"', () => {
    expect(cmd('make test', 'make testing')).toBe(false);
    expect(cmd('./gradlew test', './gradlew test')).toBe(true);
    expect(cmd('./gradlew test', 'gradlew test')).toBe(false);
  });

  it('should not match a command shorter than the pattern', () => {
    expect(cmd('python -m pytest', 'python -m')).toBe(false);
    expect(matchCommand('jest', [])).toBe(false);
  });
});

describe('matching time stays small whatever the pattern', () => {
  // The hook gives up after 5 s and then allows the call, so a pattern must never be able to
  // make one match slow. 200 ms is far above a normal match and far below the hook's limit.
  const LIMIT_MS = 200;

  function timed(match: () => boolean): { ms: number; result: boolean } {
    const start = performance.now();
    const result = match();
    return { ms: performance.now() - start, result };
  }

  it('should match **/**/**/**/**/**/x against a 100-folder path quickly', () => {
    const deep = `/work/repo/${Array.from({ length: 100 }, () => 'a').join('/')}/y`;
    const { ms, result } = timed(() => path('**/**/**/**/**/**/x', deep));
    expect(result).toBe(false);
    expect(ms).toBeLessThan(LIMIT_MS);
  });

  it('should match a*a*a*a*b against a 400-character name quickly', () => {
    const { ms, result } = timed(() => path('src/a*a*a*a*b', `/work/repo/src/${'a'.repeat(400)}`));
    expect(result).toBe(false);
    expect(ms).toBeLessThan(LIMIT_MS);
  });

  it('should match a command pattern a*a*a*a*b against a 400-character word quickly', () => {
    const { ms, result } = timed(() => matchCommand('a*a*a*a*a*a*b', ['a'.repeat(400)]));
    expect(result).toBe(false);
    expect(ms).toBeLessThan(LIMIT_MS);
  });

  it('should still find a match through many ** folders', () => {
    expect(path('**/**/**/x', '/work/repo/a/b/c/d/x')).toBe(true);
    expect(path('src/a*a*b', '/work/repo/src/aaxab')).toBe(true);
  });
});

describe('matchPath: letter case', () => {
  it('should ignore case when asked to, for a case-insensitive file system', () => {
    const ci = { ...opts, caseInsensitive: true };
    expect(matchPath('.oss/tool-gates/**', '/work/repo/.OSS/Tool-Gates/cycle.json', ci)).toBe(true);
    expect(matchPath('~/.claude/settings*.json', '/Users/dev/.Claude/Settings.json', ci)).toBe(true);
  });
});
