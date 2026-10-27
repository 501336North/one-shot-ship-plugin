/**
 * The one way oss-decrypt writes a file of its own (manifest cache, prompt cache, update state, credentials): never
 * through a symlink.
 *
 * - The directory is created if missing, then opened O_DIRECTORY|O_NOFOLLOW and must be a directory owned by this
 *   user; anything else (a symlink, another user's directory) is refused before anything is written.
 * - The one trusted link is the config directory itself (~/.oss or $OSS_CONFIG_DIR): release channels make ~/.oss a
 *   symlink to ~/.oss-stable, ~/.oss-beta or ~/.oss-dev. It is resolved once with realpath; the resolved directory
 *   gets the same checks (a real directory owned by this user). Everything inside it stays no-follow.
 * - The data goes to a fresh temp file in that directory, created O_EXCL with the writer's mode, and is renamed over
 *   the target. rename replaces a symlink at the target; it never writes through one.
 */

import { randomBytes } from 'crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, isAbsolute, join, relative } from 'path';
import { getConfigDir } from './config.js';

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
export function writeFileNoFollow(target: string, data: string, options: SafeWriteOptions): void {
  mkdirSync(dirname(target), { recursive: true, mode: options.dirMode });
  const path = inResolvedConfigDir(target);
  const dir = dirname(path);
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

/** `path` with the config directory prefix (if any) replaced by its realpath; any other path unchanged. */
function inResolvedConfigDir(path: string): string {
  const configDir = getConfigDir();
  const inside = relative(configDir, path);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return path;
  return join(realpathSync(configDir), inside);
}
