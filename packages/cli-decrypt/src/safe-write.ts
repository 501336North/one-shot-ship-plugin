/**
 * The one way oss-decrypt writes a file of its own (manifest cache, prompt cache, update state, credentials): never
 * through a symlink.
 *
 * - The directory is created if missing, then opened O_DIRECTORY|O_NOFOLLOW and must be a directory owned by this
 *   user; anything else (a symlink, another user's directory) is refused before anything is written.
 * - The data goes to a fresh temp file in that directory, created O_EXCL with the writer's mode, and is renamed over
 *   the target. rename replaces a symlink at the target; it never writes through one.
 */

import { randomBytes } from 'crypto';
import { closeSync, constants, fchmodSync, fstatSync, mkdirSync, openSync, renameSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';

export interface SafeWriteOptions {
  /** Mode of the written file. */
  mode: number;
  /** Mode for the directory when it has to be created (default: 0o777 less the umask). */
  dirMode?: number;
  /** Also set an existing directory to dirMode (through the checked descriptor). */
  enforceDirMode?: boolean;
}

/**
 * Write `data` to `path` without following a symlink at the file or its directory.
 *
 * @throws when the directory is a symlink, not a directory, or not owned by this user (nothing is written)
 */
export function writeFileNoFollow(path: string, data: string, options: SafeWriteOptions): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: options.dirMode });
  const fd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isDirectory() || stat.uid !== process.getuid?.()) {
      throw new Error(`Refusing to write ${basename(path)}: its directory must be a directory you own.`);
    }
    if (options.enforceDirMode && options.dirMode !== undefined) fchmodSync(fd, options.dirMode);
  } finally {
    closeSync(fd);
  }
  const temp = join(dir, `.${basename(path)}.${randomBytes(8).toString('hex')}.tmp`);
  writeFileSync(temp, data, { mode: options.mode, flag: 'wx' });
  renameSync(temp, path);
}
