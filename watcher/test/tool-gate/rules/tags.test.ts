/**
 * @behavior In a repo whose rules set `tagsAllowed` to false, the tool gate refuses an agent's
 *   attempt to create, delete or move a tag (`git tag v1`, `git tag -a v1 -m x`, `git tag -d v1`)
 *   and any push that carries tags (`--tags`, `--follow-tags`, `--mirror`, a `refs/tags/`
 *   destination, or git's `tag <name>` refspec), also when wrapped or nested. Read-only uses of
 *   `git tag` (listing, verifying) and ordinary branch pushes stay allowed. With `tagsAllowed`
 *   true (the default) nothing is refused.
 * @business-rule US-008: repos that don't tag stop agents from proposing tags. Listing and
 *   verifying tags changes nothing, so it is never refused.
 */

import { describe, it, expect } from 'vitest';
import { readCommand, type CommandPart } from '../../../src/tool-gate/command-reader.js';
import type { GateSettings } from '../../../src/tool-gate/rule-file.js';
import { checkTags } from '../../../src/tool-gate/rules/tags.js';

const CWD = '/work/repo';
const HOME = '/home/dev';

function settings(tagsAllowed: boolean): GateSettings {
  return {
    version: 1,
    protectedBranches: ['main', 'master'],
    testFilePatterns: [],
    testCommandPatterns: [],
    sourceExtensions: [],
    protectedPaths: [],
    productionHosts: [],
    tagsAllowed,
  };
}

const NO_TAGS = settings(false);
const TAGS_OK = settings(true);

function partsOf(cmd: string): CommandPart[] {
  const result = readCommand(cmd, CWD, HOME);
  if ('unreadable' in result) throw new Error(`expected a readable command: ${result.reason}`);
  return result.parts;
}

function check(cmd: string, gateSettings: GateSettings = NO_TAGS) {
  return partsOf(cmd).map((part) => checkTags(part, gateSettings)).find((r) => r !== null) ?? null;
}

const TAG_CHANGES = [
  'git tag v1',
  'git tag -a v1 -m x',
  'git tag -s v1',
  'git tag -u ABCD v1',
  'git tag -f v1 HEAD~1',
  'git tag -d v1',
  'git tag -m release v1',
  'git tag -F notes.txt v1',
  'git tag -am x v1',
  'git tag --annotate --message=x v1',
  'git tag --delete v1',
  'git tag -d',
  'git tag -m x',
];

const TAG_PUSHES: [string, string][] = [
  ['git push --tags', '--tags'],
  ['git push --tag', '--tags'],
  ['git push origin --tags', '--tags'],
  ['git push --follow-tags', '--follow-tags'],
  ['git push --mirror origin', '--mirror'],
  ['git push origin refs/tags/v1', 'refs/tags/v1'],
  ['git push origin v1:refs/tags/v1', 'v1:refs/tags/v1'],
  ['git push origin :refs/tags/v1', ':refs/tags/v1'],
  ['git push origin feature tag v1', 'tag v1'],
];

describe('tags rule: a repo that does not use tags', () => {
  it.each(TAG_CHANGES)('should refuse %s, which creates, deletes or moves a tag', (cmd) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('tags');
    expect(refusal?.reason).toMatch(/^Refused: /);
    expect(refusal?.reason).toContain(`\`${cmd}\``);
    expect(refusal?.reason).toContain('tagsAllowed is false in .oss/tool-gates.json');
  });

  it.each(TAG_PUSHES)('should refuse %s, which pushes tags, naming %s', (cmd, named) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('tags');
    expect(refusal?.reason).toContain(`\`git push ${named}\``);
    expect(refusal?.reason).toContain('tagsAllowed is false in .oss/tool-gates.json');
  });

  it('should give the reason in the documented wording', () => {
    expect(check('git tag v1')?.reason).toBe(
      "Refused: `git tag v1`: this repo doesn't use tags (tagsAllowed is false in .oss/tool-gates.json).",
    );
    expect(check('git push --tags')?.reason).toBe(
      "Refused: `git push --tags`: this repo doesn't use tags (tagsAllowed is false in .oss/tool-gates.json).",
    );
  });

  it.each(["bash -c 'git tag v1'", 'sudo git tag v1', "sh -c 'git push --tags'", 'git -C sub tag v1'])(
    'should refuse a tag change hidden inside another command: %s',
    (cmd) => {
      expect(check(cmd)?.rule).toBe('tags');
    },
  );

  it.each([
    'git tag --message -l v1',
    'git tag --mess -l v1',
    'git tag -u -l v1',
    'git tag -m -l v1',
    'git tag -ml v1',
  ])('should refuse %s, where -l is an option value, not a request to list', (cmd) => {
    expect(check(cmd)?.rule).toBe('tags');
  });
});

describe('tags rule: reading tags is always allowed', () => {
  it.each([
    'git tag',
    'git tag -l',
    "git tag -l 'v1.*'",
    "git tag --list 'v*'",
    'git tag -n',
    'git tag -n5',
    'git tag --contains HEAD',
    'git tag --points-at HEAD',
    'git tag --merged main',
    'git tag --no-merged main',
    'git tag --sort=-version:refname',
    'git tag --sort refname',
    'git tag --column',
    'git tag -v v1',
    'git tag --verify v1',
  ])('should allow %s when tags are off', (cmd) => {
    expect(check(cmd)).toBeNull();
  });

  it.each(['git push', 'git push origin feature', 'git push -u origin HEAD:feature', 'git push origin refs/heads/feature'])(
    'should allow the branch push %s when tags are off',
    (cmd) => {
      expect(check(cmd)).toBeNull();
    },
  );

  it.each(['git fetch --tags', 'git log --tags', 'echo git tag v1', 'git describe --tags'])(
    'should leave %s to other rules',
    (cmd) => {
      expect(check(cmd)).toBeNull();
    },
  );
});

describe('tags rule: a repo that allows tags (the default)', () => {
  it.each([...TAG_CHANGES, ...TAG_PUSHES.map(([cmd]) => cmd)])('should allow %s', (cmd) => {
    expect(check(cmd, TAGS_OK)).toBeNull();
  });
});

describe('tags rule: wildcard refspecs', () => {
  it.each(["git push origin 'refs/*:refs/*'", "git push origin '*:*'", "git push origin 'refs/t*:refs/t*'", "git push origin 'refs/tags/v*'"])(
    'should refuse %s when tags are off, since the wildcard can name a tag',
    (cmd) => {
      expect(check(cmd)?.rule).toBe('tags');
    },
  );

  it('should allow a wildcard that names branches only', () => {
    expect(check("git push origin 'refs/heads/feat/*:refs/heads/feat/*'")).toBeNull();
  });
});
