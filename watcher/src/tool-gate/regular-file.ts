/**
 * Reads a regular file without ever blocking on it. It opens with `O_NONBLOCK` and checks what it
 * opened (`fstat`), so a named pipe or device, even one swapped in after a look, can't stall the
 * gate: a gate slower than its time limit allows the call. With `noFollow`, a symlink at the path
 * is not followed (`O_NOFOLLOW`) and counts as not regular.
 */

import fs from 'node:fs';

export type RegularFileRead = { text: string } | 'missing' | 'not-regular';

/**
 * 'missing' when nothing is there, 'not-regular' for a pipe, device, folder, a file of `maxBytes`
 * or more, a symlink when `noFollow` is set, or a file that can't be opened.
 */
export function readRegularFile(absPath: string, maxBytes: number, noFollow = false): RegularFileRead {
  const { O_RDONLY, O_NONBLOCK, O_NOFOLLOW } = fs.constants;
  let fd: number;
  try {
    fd = fs.openSync(absPath, O_RDONLY | O_NONBLOCK | (noFollow ? O_NOFOLLOW : 0));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'not-regular';
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size >= maxBytes) return 'not-regular';
    return { text: fs.readFileSync(fd, 'utf8') };
  } catch {
    return 'not-regular';
  } finally {
    fs.closeSync(fd);
  }
}
