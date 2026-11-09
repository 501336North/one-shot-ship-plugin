/**
 * @behavior On a real disk, a path that climbs out of a symlinked folder with `..` is checked
 *   where the disk puts it: with `link` → `.oss/tool-gates`, `link/../tool-gates.json` is the
 *   repo's rule file, so writing it with Edit, Write or a Bash redirect is refused. An ordinary
 *   `..` that crosses no link is still allowed.
 * @business-rule US-006 edge case: a link can't hide a protected file from the gate, also when
 *   the path climbs back out of the link.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCommand } from '../../../src/tool-gate/command-reader.js';
import { readEditCall } from '../../../src/tool-gate/edit-call.js';
import { realPathResolver } from '../../../src/tool-gate/path-resolver.js';
import { loadSettings } from '../../../src/tool-gate/rule-file.js';
import { checkProtectedPathBash, checkProtectedPathEdit } from '../../../src/tool-gate/rules/protected-path.js';

const PLUGIN_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-protected-path-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A repo whose `link` points at its `.oss/tool-gates` folder, and an empty home. */
function repoWithLink() {
  const root = tempDir();
  const home = tempDir();
  fs.mkdirSync(path.join(root, '.oss', 'tool-gates'), { recursive: true });
  fs.mkdirSync(path.join(root, 'sub'));
  fs.symlinkSync(path.join(root, '.oss', 'tool-gates'), path.join(root, 'link'));
  const settings = loadSettings(
    (p) => (p.startsWith(PLUGIN_ROOT) ? fs.readFileSync(p, 'utf8') : null),
    PLUGIN_ROOT,
    root,
  ).settings;
  const checkEdit = (tool: string, filePath: string) => {
    const call = readEditCall(tool, { file_path: filePath, old_string: 'a', new_string: 'b', content: 'b' }, root, home, () => null);
    if (call === null) throw new Error('expected an edit call');
    return checkProtectedPathEdit(call, settings, root, home, realPathResolver);
  };
  const checkBash = (cmd: string) => {
    const facts = readCommand(cmd, root, home);
    if ('unreadable' in facts) throw new Error('expected a readable command');
    return facts.parts.map((part) => checkProtectedPathBash(part, settings, root, home, realPathResolver)).find((r) => r !== null) ?? null;
  };
  return { checkEdit, checkBash };
}

describe('protected-path rule on a real disk: .. after a symlinked folder', () => {
  for (const tool of ['Edit', 'Write']) {
    it(`should refuse ${tool} on link/../tool-gates.json`, () => {
      expect(repoWithLink().checkEdit(tool, 'link/../tool-gates.json')?.rule).toBe('protected-path');
    });
  }

  it('should refuse echo x > link/../tool-gates.json', () => {
    expect(repoWithLink().checkBash('echo x > link/../tool-gates.json')?.rule).toBe('protected-path');
  });

  it('should allow an ordinary .. that crosses no link', () => {
    const repo = repoWithLink();
    expect(repo.checkEdit('Write', 'sub/../notes.txt')).toBeNull();
    expect(repo.checkBash('echo x > sub/../notes.txt')).toBeNull();
  });
});
