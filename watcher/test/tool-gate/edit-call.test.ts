/**
 * @behavior When the agent edits a file (Edit, MultiEdit, Write or NotebookEdit), the tool gate
 *   reads the call into one shape: which tool, the absolute file path, and each change as the
 *   text before and after. For Write, "before" is what the file holds now ('' for a new file).
 *   Relative paths are read against the session's directory and `~/` is the user's home.
 *   Any other tool, or a call whose input is not shaped as expected, gives nothing to check.
 * @business-rule The edit rules (skipped tests, protected paths, RED cycle) judge what an edit
 *   adds, so every edit tool must be read the same way, and a malformed call never crashes the gate.
 */

import { describe, it, expect } from 'vitest';
import { readEditCall } from '../../src/tool-gate/edit-call.js';

const CWD = '/work/repo';
const HOME = '/home/dev';

function filesOnDisk(files: Record<string, string>) {
  const asked: string[] = [];
  const readFile = (p: string): string | null => {
    asked.push(p);
    return files[p] ?? null;
  };
  return { readFile, asked };
}

const NO_FILES = filesOnDisk({}).readFile;

describe('reading an edit-tool call', () => {
  it('should read an Edit as one change from the old text to the new text', () => {
    const call = readEditCall(
      'Edit',
      { file_path: '/work/repo/src/a.ts', old_string: 'one', new_string: 'two' },
      CWD,
      HOME,
      NO_FILES,
    );
    expect(call).toEqual({
      tool: 'Edit',
      filePath: '/work/repo/src/a.ts',
      changes: [{ before: 'one', after: 'two' }],
    });
  });

  it('should read a MultiEdit as one change per edit, in order', () => {
    const call = readEditCall(
      'MultiEdit',
      {
        file_path: '/work/repo/src/a.ts',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      },
      CWD,
      HOME,
      NO_FILES,
    );
    expect(call).toEqual({
      tool: 'MultiEdit',
      filePath: '/work/repo/src/a.ts',
      changes: [
        { before: 'a', after: 'b' },
        { before: 'c', after: 'd' },
      ],
    });
  });

  it('should read a Write as replacing what the file holds on disk now', () => {
    const disk = filesOnDisk({ '/work/repo/src/a.ts': 'old body' });
    const call = readEditCall('Write', { file_path: '/work/repo/src/a.ts', content: 'new body' }, CWD, HOME, disk.readFile);
    expect(call).toEqual({
      tool: 'Write',
      filePath: '/work/repo/src/a.ts',
      changes: [{ before: 'old body', after: 'new body' }],
    });
    expect(disk.asked).toEqual(['/work/repo/src/a.ts']);
  });

  it('should read a Write of a new file as adding all of its content', () => {
    const call = readEditCall('Write', { file_path: '/work/repo/new.ts', content: 'hello' }, CWD, HOME, NO_FILES);
    expect(call?.changes).toEqual([{ before: '', after: 'hello' }]);
  });

  it('should read a NotebookEdit as adding the new cell source to the notebook', () => {
    const call = readEditCall(
      'NotebookEdit',
      { notebook_path: '/work/repo/nb/x.ipynb', new_source: 'print(1)', cell_id: 'c1' },
      CWD,
      HOME,
      NO_FILES,
    );
    expect(call).toEqual({
      tool: 'NotebookEdit',
      filePath: '/work/repo/nb/x.ipynb',
      changes: [{ before: '', after: 'print(1)' }],
    });
  });

  it('should read a NotebookEdit that deletes a cell as adding nothing', () => {
    const call = readEditCall(
      'NotebookEdit',
      { notebook_path: '/work/repo/nb/x.ipynb', new_source: 'print(1)', edit_mode: 'delete' },
      CWD,
      HOME,
      NO_FILES,
    );
    expect(call?.changes).toEqual([{ before: '', after: '' }]);
  });

  it('should read a relative path against the session directory', () => {
    const call = readEditCall('Edit', { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' }, CWD, HOME, NO_FILES);
    expect(call?.filePath).toBe('/work/repo/src/a.ts');
  });

  it('should read a path starting with ~/ as under the home folder', () => {
    const call = readEditCall('Edit', { file_path: '~/notes/a.md', old_string: 'x', new_string: 'y' }, CWD, HOME, NO_FILES);
    expect(call?.filePath).toBe('/home/dev/notes/a.md');
  });

  it('should read the file on disk at the resolved path for a relative Write', () => {
    const disk = filesOnDisk({ '/work/repo/src/a.ts': 'old' });
    const call = readEditCall('Write', { file_path: 'src/a.ts', content: 'new' }, CWD, HOME, disk.readFile);
    expect(call?.changes).toEqual([{ before: 'old', after: 'new' }]);
  });

  it('should give nothing to check for a tool that does not edit files', () => {
    expect(readEditCall('Bash', { command: 'ls' }, CWD, HOME, NO_FILES)).toBeNull();
    expect(readEditCall('Read', { file_path: '/work/repo/a.ts' }, CWD, HOME, NO_FILES)).toBeNull();
  });

  const MALFORMED: [string, unknown][] = [
    ['Edit', null],
    ['Edit', 'not an object'],
    ['Edit', { old_string: 'a', new_string: 'b' }],
    ['Edit', { file_path: 7, old_string: 'a', new_string: 'b' }],
    ['Edit', { file_path: '/work/repo/a.ts', old_string: 'a' }],
    ['Edit', { file_path: '/work/repo/a.ts', old_string: 1, new_string: 'b' }],
    ['Write', { file_path: '/work/repo/a.ts' }],
    ['Write', { file_path: '/work/repo/a.ts', content: 42 }],
    ['Write', { content: 'x' }],
    ['MultiEdit', { file_path: '/work/repo/a.ts' }],
    ['MultiEdit', { file_path: '/work/repo/a.ts', edits: 'nope' }],
    ['MultiEdit', { file_path: '/work/repo/a.ts', edits: [null] }],
    ['MultiEdit', { file_path: '/work/repo/a.ts', edits: [{ old_string: 'a', new_string: 2 }] }],
    ['NotebookEdit', { new_source: 'x' }],
    ['NotebookEdit', { notebook_path: '/work/repo/x.ipynb', new_source: 3 }],
    ['NotebookEdit', { notebook_path: '/work/repo/x.ipynb' }],
  ];

  it.each(MALFORMED)('should give nothing to check for a malformed %s call %#', (tool, input) => {
    expect(readEditCall(tool, input, CWD, HOME, NO_FILES)).toBeNull();
  });
});

describe('reading an edit-tool call: .. is kept for the disk to resolve', () => {
  // `link/..` is the folder that holds what `link` points to, not the folder `link` sits in, so
  // only the disk can say where it lands; the path keeps its `..` for the protected-path check.
  it('should keep a .. that follows a folder name in a relative path', () => {
    const call = readEditCall('Write', { file_path: 'link/../tool-gates.json', content: 'x' }, CWD, HOME, NO_FILES);
    expect(call?.filePath).toBe('/work/repo/link/../tool-gates.json');
  });

  it('should keep a .. in an absolute path and in a ~/ path', () => {
    const abs = readEditCall('Edit', { file_path: '/work/repo/a/../b.ts', old_string: 'x', new_string: 'y' }, CWD, HOME, NO_FILES);
    const home = readEditCall('Edit', { file_path: '~/a/../b.md', old_string: 'x', new_string: 'y' }, CWD, HOME, NO_FILES);
    expect(abs?.filePath).toBe('/work/repo/a/../b.ts');
    expect(home?.filePath).toBe('/home/dev/a/../b.md');
  });

  it('should still drop . and doubled slashes', () => {
    const call = readEditCall('Edit', { file_path: './src//a.ts', old_string: 'x', new_string: 'y' }, CWD, HOME, NO_FILES);
    expect(call?.filePath).toBe('/work/repo/src/a.ts');
  });
});
