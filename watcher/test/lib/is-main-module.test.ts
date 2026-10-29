/**
 * isMainModule Tests — "was this file run as the program?"
 *
 * @behavior A CLI run through a symlink (as the plugin's installed bin links are) still runs: the
 *           check compares the real path of the invoked file with the module's own path.
 * @business-rule A CLI that silently prints nothing and exits 0 when invoked through a symlink would
 *                let the decision hook commit an empty (or unredacted) record; the check must follow links.
 * @boundary watcher/src/lib/is-main-module.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { isMainModule } from '../../src/lib/is-main-module.js';

describe('isMainModule', () => {
  let dir: string;
  let moduleFile: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'is-main-module-'));
    moduleFile = path.join(dir, 'cli.js');
    fs.writeFileSync(moduleFile, '');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should be true when the program was invoked through a symlink to the module file', () => {
    const link = path.join(dir, 'linked-cli.js');
    fs.symlinkSync(moduleFile, link);
    const metaUrl = pathToFileURL(fs.realpathSync(moduleFile)).href;

    expect(isMainModule(metaUrl, link)).toBe(true);
  });

  it('should be true when both the invoked file and the module URL are links to the same real file', () => {
    // node --preserve-symlinks-main keeps the link path in import.meta.url, so both sides must be resolved.
    const linkA = path.join(dir, 'bin-a.js');
    const linkB = path.join(dir, 'bin-b.js');
    fs.symlinkSync(moduleFile, linkA);
    fs.symlinkSync(moduleFile, linkB);

    expect(isMainModule(pathToFileURL(linkA).href, linkB)).toBe(true);
  });

  it('should be false when the program is another file', () => {
    const other = path.join(dir, 'other.js');
    fs.writeFileSync(other, '');
    const metaUrl = pathToFileURL(fs.realpathSync(moduleFile)).href;

    expect(isMainModule(metaUrl, other)).toBe(false);
  });

  it('should be false when there is no invoked file or it does not exist', () => {
    const metaUrl = pathToFileURL(fs.realpathSync(moduleFile)).href;

    expect(isMainModule(metaUrl, undefined)).toBe(false);
    expect(isMainModule(metaUrl, path.join(dir, 'missing.js'))).toBe(false);
  });
});
