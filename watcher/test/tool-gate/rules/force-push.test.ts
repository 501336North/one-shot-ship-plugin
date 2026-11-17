/**
 * @behavior The tool gate refuses an agent's force push on any branch: `--force`, `-f`,
 *   `--force-with-lease`, `--force-if-includes`, a short-flag cluster holding `f`, or a refspec
 *   with a leading `+`, also when wrapped (`sudo`) or nested (`bash -c`). A push without force
 *   is allowed.
 * @business-rule IRON LAW #4: agents never rewrite history with a force push. Only single-dash
 *   clusters hold short flags, and the value of `-o` is not a flag.
 */

import { describe, it, expect } from 'vitest';
import { readCommand, type CommandPart } from '../../../src/tool-gate/command-reader.js';
import type { GateSettings } from '../../../src/tool-gate/rule-file.js';
import { checkForcePush } from '../../../src/tool-gate/rules/force-push.js';

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
  gateAgents: [],
  tagsAllowed: true,
};

function partsOf(cmd: string): CommandPart[] {
  const result = readCommand(cmd, CWD, HOME);
  if ('unreadable' in result) throw new Error(`expected a readable command: ${result.reason}`);
  return result.parts;
}

function check(cmd: string) {
  return partsOf(cmd).map((part) => checkForcePush(part, SETTINGS)).find((r) => r !== null) ?? null;
}

describe('force-push rule: refusing a push that rewrites history', () => {
  it.each([
    ['git push --force', '--force'],
    ['git push -f', '-f'],
    ['git push --force-with-lease', '--force-with-lease'],
    ['git push --force-with-lease=main', '--force-with-lease=main'],
    ['git push --force-with-lease=main:abc', '--force-with-lease=main:abc'],
    ['git push --force-if-includes', '--force-if-includes'],
    ['git push -fu origin feature', '-fu'],
    ['git push -uf origin feature', '-uf'],
    ['git push origin +feature', '+feature'],
    ['git push origin +HEAD:feature', '+HEAD:feature'],
  ])('should refuse %s on any branch, naming %s', (cmd, flag) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('force-push');
    expect(refusal?.reason).toMatch(/^Refused: /);
    expect(refusal?.reason).toContain(`\`git push ${flag}\``);
    expect(refusal?.reason).toContain('rewrites history');
    expect(refusal?.reason).toContain('ask the user');
  });

  it('should give the reason in the documented wording', () => {
    expect(check('git push --force')?.reason).toBe(
      'Refused: `git push --force` rewrites history. Push without force; if the branch diverged, ask the user.',
    );
  });

  it.each(["bash -c 'git push -f'", 'sudo git push --force'])(
    'should refuse a force push hidden inside another command: %s',
    (cmd) => {
      expect(check(cmd)?.rule).toBe('force-push');
    },
  );
});

describe('force-push rule: shortened force options', () => {
  it.each([
    ['git push --forc', '--force'],
    ['git push --force-w', '--force-with-lease'],
  ])('should refuse %s, which git reads as %s', (cmd, full) => {
    const refusal = check(cmd);
    expect(refusal?.rule).toBe('force-push');
    expect(refusal?.reason).toContain(`\`git push ${full}\``);
  });

  it('should allow git push --f, which could mean --force or --follow-tags', () => {
    expect(check('git push --f')).toBeNull();
  });

  it('should allow git push --no-force, which turns force off', () => {
    expect(check('git push --no-force')).toBeNull();
  });
});

describe('force-push rule: pushes without force and other commands', () => {
  it.each([
    'git push',
    'git push origin feature',
    'git push --follow-tags',
    'git push -o force origin x',
    'git push -u origin HEAD:feature',
  ])('should allow %s', (cmd) => {
    expect(check(cmd)).toBeNull();
  });

  it.each(['git fetch -f', 'git checkout -f', 'git reset --hard', 'echo git push --force'])(
    'should leave %s to other rules',
    (cmd) => {
      expect(check(cmd)).toBeNull();
    },
  );
});
