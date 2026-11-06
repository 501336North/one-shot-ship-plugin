/**
 * No test mocks the hang-safe reader (Task 70e round 2)
 *
 * @behavior Fails when any watcher test file replaces src/utils/regular-file with vi.mock / vi.doMock.
 * @business-rule Iron Law #2: our own modules are never mocked. The reader is the one guard against a FIFO or a
 *           device hanging the watcher, so every test that reads a file must run it (on a real file, or on an fs
 *           faked at the system-call level).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const TEST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function testFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return testFiles(p);
    return e.isFile() && p.endsWith('.ts') ? [p] : [];
  });
}

describe('the hang-safe reader is never mocked (Task 70e round 2)', () => {
  it('no test file mocks src/utils/regular-file', () => {
    const offenders = testFiles(TEST_ROOT).filter((f) =>
      /vi\.(do)?[mM]ock\(\s*['"][^'"]*utils\/regular-file(\.js)?['"]/.test(fs.readFileSync(f, 'utf-8')),
    );

    expect(offenders.map((f) => path.relative(TEST_ROOT, f))).toEqual([]);
  });
});
