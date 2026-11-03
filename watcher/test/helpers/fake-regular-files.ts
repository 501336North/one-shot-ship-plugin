/**
 * For a test that fakes files with an auto-mocked `fs` (`vi.mock('fs')`, existsSync / readFileSync answered per
 * path): the low-level calls the real hang-safe reader makes (src/utils/regular-file, T70e) answer from the same
 * fakes, so the real reader runs on the fake fs. A path existsSync calls present is a regular file of the person;
 * any other path is ENOENT. Its open "fd" is the path itself, so readFileSync(fd) still answers by path.
 * Call it in beforeEach, after the test's own mock setup.
 */
import type * as fsModule from 'fs';
import { vi } from 'vitest';

export function fakeRegularFiles(fs: typeof fsModule): void {
  const regular = { isFile: () => true, uid: process.getuid?.() ?? 0 } as fsModule.Stats;
  const found = (p: fsModule.PathLike): void => {
    if (!fs.existsSync(p)) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${String(p)}'`), { code: 'ENOENT' });
    }
  };
  vi.mocked(fs.statSync).mockImplementation(((p: fsModule.PathLike) => {
    found(p);
    return regular;
  }) as typeof fs.statSync);
  vi.mocked(fs.openSync).mockImplementation(((p: fsModule.PathLike) => {
    found(p);
    return p as unknown as number;
  }) as typeof fs.openSync);
  vi.mocked(fs.fstatSync).mockImplementation((() => regular) as typeof fs.fstatSync);
  vi.mocked(fs.closeSync).mockImplementation(() => undefined);
}
