/**
 * @behavior When the agent edits a test file (one matching `testFilePatterns`) and the edit adds
 *   a skip, focus or todo marker (`.skip(`, `.only(`, `.todo(`, or their `If` forms such as
 *   `.skipIf(`), the tool gate refuses it, for Edit, MultiEdit, Write and NotebookEdit alike.
 *   Markers that were already there and are kept do not count; only newly added ones do. The
 *   same text in a file that isn't a test file is allowed. The reason names the file and the
 *   marker and never repeats what was written.
 * @business-rule US-003 / IRON LAW #1: never skip or focus tests; fix or delete the test instead.
 */

import { describe, it, expect } from 'vitest';
import { readEditCall, type EditCall } from '../../../src/tool-gate/edit-call.js';
import type { GateSettings } from '../../../src/tool-gate/rule-file.js';
import { checkFocusedTests } from '../../../src/tool-gate/rules/focused-tests.js';

const ROOT = '/work/repo';
const HOME = '/home/dev';

// Marker strings are built at runtime so this repo's own scans never see them as real markers.
const SKIP = '.' + 'skip(';
const ONLY = '.' + 'only(';
const TODO = '.' + 'todo(';
const SKIP_IF = '.' + 'skipIf(';
const ONLY_SPACED = '.' + 'only (';

const SETTINGS: GateSettings = {
  version: 1,
  protectedBranches: ['main', 'master'],
  testFilePatterns: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/test_*.sh', '**/*_test.go'],
  testCommandPatterns: [],
  sourceExtensions: [],
  protectedPaths: [],
  productionHosts: [],
  tagsAllowed: true,
};

function editCall(tool: string, input: unknown, disk: Record<string, string> = {}): EditCall {
  const call = readEditCall(tool, input, ROOT, HOME, (p) => disk[p] ?? null);
  if (call === null) throw new Error('expected an edit call');
  return call;
}

function check(call: EditCall) {
  return checkFocusedTests(call, SETTINGS, ROOT, HOME);
}

function edit(filePath: string, before: string, after: string) {
  return editCall('Edit', { file_path: filePath, old_string: before, new_string: after });
}

describe('skipped and focused tests rule', () => {
  it('should refuse a Write that puts a focused test into a new test file', () => {
    const refusal = check(editCall('Write', { file_path: 'src/foo.test.ts', content: `it${ONLY}'x', () => {});` }));
    expect(refusal?.rule).toBe('focused-tests');
  });

  it('should refuse a Write that adds a focused test the file on disk did not have', () => {
    const refusal = check(
      editCall(
        'Write',
        { file_path: 'src/foo.test.ts', content: `it${ONLY}'x', () => {});` },
        { '/work/repo/src/foo.test.ts': `it('x', () => {});` },
      ),
    );
    expect(refusal?.rule).toBe('focused-tests');
  });

  it('should refuse an Edit that skips a whole describe block in a test file', () => {
    const refusal = check(edit('src/foo.test.ts', `describe('a', () => {`, `describe${SKIP}'a', () => {`));
    expect(refusal?.rule).toBe('focused-tests');
  });

  it('should refuse a MultiEdit whose second edit marks a test as todo', () => {
    const refusal = check(
      editCall('MultiEdit', {
        file_path: 'src/foo.test.ts',
        edits: [
          { old_string: 'const a = 1;', new_string: 'const a = 2;' },
          { old_string: `test('later', () => {});`, new_string: `test${TODO}'later');` },
        ],
      }),
    );
    expect(refusal?.rule).toBe('focused-tests');
  });

  it('should refuse a NotebookEdit that adds a skip to a test notebook', () => {
    const refusal = check(
      editCall('NotebookEdit', { notebook_path: 'nb/x.test.ipynb', new_source: `pytest.mark${SKIP}reason='x')` }),
    );
    expect(refusal?.rule).toBe('focused-tests');
  });

  it('should allow the same focused test text in a file that is not a test file', () => {
    expect(check(editCall('Write', { file_path: 'src/foo.ts', content: `it${ONLY}'x', () => {});` }))).toBeNull();
    expect(check(edit('src/foo.ts', 'a', `describe${SKIP}'a'`))).toBeNull();
  });

  it('should allow an edit that keeps an existing skip while changing other text', () => {
    const before = `describe${SKIP}'a', () => { const x = 1; });`;
    const after = `describe${SKIP}'a', () => { const x = 2; });`;
    expect(check(edit('src/foo.test.ts', before, after))).toBeNull();
  });

  it('should allow a Write that keeps the skips the file on disk already had', () => {
    const disk = { '/work/repo/src/foo.test.ts': `it${SKIP}'x', () => {});` };
    const call = editCall('Write', { file_path: 'src/foo.test.ts', content: `it${SKIP}'x', () => { 1; });` }, disk);
    expect(check(call)).toBeNull();
  });

  it('should allow an edit that removes a skip', () => {
    expect(check(edit('src/foo.test.ts', `it${SKIP}'x'`, `it('x'`))).toBeNull();
  });

  it('should refuse swapping an existing skip for a focus, since the focus is new', () => {
    const refusal = check(edit('src/foo.test.ts', `it${SKIP}'x'`, `it${ONLY}'x'`));
    expect(refusal?.reason).toContain('`.only(`');
  });

  it('should catch the conditional form and a space before the bracket', () => {
    expect(check(edit('src/foo.test.ts', 'it(', `it${SKIP_IF}true)(`))?.rule).toBe('focused-tests');
    expect(check(edit('src/foo.test.ts', 'it(', `it${ONLY_SPACED}`))?.rule).toBe('focused-tests');
  });

  it('should not mistake longer names that merely start with a marker word', () => {
    expect(check(edit('src/foo.test.ts', 'a', `it.${'skip'}ped('x')`))).toBeNull();
    expect(check(edit('src/foo.test.ts', 'a', `x.${'only'}Foo('x')`))).toBeNull();
  });

  it('should name the file and the marker in the reason, never the written content', () => {
    const refusal = check(
      editCall('Write', { file_path: 'src/foo.test.ts', content: `it${ONLY}'secret-content-xyz', () => {});` }),
    );
    expect(refusal).toEqual({
      rule: 'focused-tests',
      reason:
        'Refused: adds `.only(` to the test file `src/foo.test.ts`. IRON LAW #1: never skip or focus tests. Fix or delete the test instead.',
    });
    expect(refusal?.reason).not.toContain('secret-content-xyz');
  });

  it('should name the conditional marker as written', () => {
    const refusal = check(edit('src/foo.test.ts', 'it(', `it${SKIP_IF}true)(`));
    expect(refusal?.reason).toContain('`.skipIf(`');
  });

  // Built at runtime too: `xit(`, `fdescribe(` …, the table forms and the concurrent forms.
  const X_AND_F_CALLS = ['x' + 'it', 'f' + 'it', 'x' + 'describe', 'f' + 'describe', 'x' + 'test'];
  const CHAINED = [
    '.' + 'only.each([1])(', '.' + 'skip.each([1])(', '.' + 'only.each`a`', '.' + 'skip.each`a`',
    '.concurrent' + '.only(', '.concurrent' + '.skip(', '.' + 'skip.concurrent(',
  ];

  it.each(X_AND_F_CALLS)('should refuse adding a %s( call that skips or focuses a test', (name) => {
    const refusal = check(edit('src/foo.test.ts', 'a', `${name}('x', () => {});`));
    expect(refusal?.rule).toBe('focused-tests');
    expect(refusal?.reason).toContain(`\`${name}(\``);
  });

  it.each(CHAINED)('should refuse adding the chained form test%s', (form) => {
    expect(check(edit('src/foo.test.ts', 'a', `test${form}'x', () => {})`))?.rule).toBe('focused-tests');
  });

  it('should not mistake calls whose names end in a marker word', () => {
    for (const call of ['submit(', 'profit(', 'exit(', 'obj.' + 'xit(', 'fitness(', 'my_' + 'xtest(']) {
      expect(check(edit('src/foo.test.ts', 'a', `${call}1);`))).toBeNull();
    }
  });

  it('should name a test file outside the repo by its full path', () => {
    const refusal = check(editCall('Write', { file_path: '/elsewhere/bar.test.ts', content: `it${ONLY}'x')` }));
    expect(refusal?.reason).toContain('`/elsewhere/bar.test.ts`');
  });
});
