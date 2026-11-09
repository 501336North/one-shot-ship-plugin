/**
 * @behavior The words after `git push` are read the way git reads them: a shortened long option
 *   such as `--forc`, `--mir` or `--del` counts as the full option it stands for, so the push
 *   rules cannot be dodged by abbreviating. A shortening that could mean two different options
 *   (`--f`: `--force` or `--follow-tags`) is kept as written.
 * @business-rule git accepts any unambiguous prefix of a long option. A "no-" option such as
 *   `--no-force-with-lease` turns force off and never counts as a force option. The value of an
 *   option like `--push-option` is neither an option nor a branch, also when abbreviated.
 */

import { describe, it, expect } from 'vitest';
import { readPushWords } from '../../../src/tool-gate/rules/push-words.js';

describe('reading git push words: shortened long options', () => {
  it.each([
    ['--forc', '--force'],
    ['--force-w', '--force-with-lease'],
    ['--force-i', '--force-if-includes'],
    ['--mir', '--mirror'],
    ['--al', '--all'],
    ['--bra', '--branches'],
    ['--del', '--delete'],
    ['--tag', '--tags'],
  ])('should read %s as %s', (written, full) => {
    expect(readPushWords([written]).options).toEqual([full]);
  });

  it('should keep a value written after = when expanding the option', () => {
    expect(readPushWords(['--force-w=main:abc']).options).toEqual(['--force-with-lease=main:abc']);
  });

  it('should keep a full option exactly as written', () => {
    expect(readPushWords(['--force', '--all', '--tags']).options).toEqual(['--force', '--all', '--tags']);
  });

  it.each(['--f', '--fo', '--ver', '--no-'])('should keep %s as written because it could mean several options', (written) => {
    expect(readPushWords([written]).options).toEqual([written]);
  });

  it('should keep an option git does not know as written', () => {
    expect(readPushWords(['--frobnicate']).options).toEqual(['--frobnicate']);
  });

  it.each(['--no-force', '--no-force-w'])('should read %s as turning force off, not on', (written) => {
    expect(readPushWords([written]).options).toEqual(['--no-force-with-lease']);
  });

  it('should leave single-dash flags alone', () => {
    expect(readPushWords(['-f', '-u']).options).toEqual(['-f', '-u']);
  });
});

describe('reading git push words: values of shortened options', () => {
  it.each([
    [['--push-opt', 'x', 'origin', 'feature']],
    [['--push-o', 'x', 'origin', 'feature']],
    [['--rep', 'x', 'origin', 'feature']],
    [['--receive', 'x', 'origin', 'feature']],
    [['--exe', 'x', 'origin', 'feature']],
  ])('should skip the value after %j', (args) => {
    expect(readPushWords(args)).toEqual({ options: [], positional: ['origin', 'feature'] });
  });
});
