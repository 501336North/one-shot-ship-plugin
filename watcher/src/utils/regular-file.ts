/**
 * The one hang-safe way the watcher reads a file a user or a repo can write (T70e): ~/.oss, a project's .oss,
 * ~/.claude, tmp, logs. The path is stat'ed first (links followed) and anything but a regular file is refused
 * without being opened, so a device is never opened (round 2). The file is then opened non-blocking, so a FIFO
 * swapped in never blocks the open, and checked with fstat on that open file, so it cannot be swapped between the
 * check and the read. Anything but a regular file (a FIFO,
 * a device, a folder), and with `owner` a file someone else owns, throws ENOENT: each caller already handles a
 * missing file, so that is how it treats these.
 */

import * as fs from 'fs';

const FLAGS = fs.constants.O_RDONLY | fs.constants.O_NONBLOCK;

function notRegular(file: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: not a regular file, open '${file}'`), { code: 'ENOENT' });
}

function refused(st: fs.Stats, owner: number | undefined): boolean {
  return !st.isFile() || (owner !== undefined && st.uid !== owner);
}

/** readFileSync(file, 'utf-8') for a regular file only (and, with `owner`, only one that uid owns). */
export function readRegularFileSync(file: string, owner?: number): string {
  if (!fs.statSync(file).isFile()) {
    throw notRegular(file);
  }
  const fd = fs.openSync(file, FLAGS);
  try {
    if (refused(fs.fstatSync(fd), owner)) {
      throw notRegular(file);
    }
    return fs.readFileSync(fd, 'utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

/** fs.promises.readFile(file, 'utf-8') for a regular file only. */
export async function readRegularFile(file: string): Promise<string> {
  if (!(await fs.promises.stat(file)).isFile()) {
    throw notRegular(file);
  }
  const handle = await fs.promises.open(file, FLAGS);
  try {
    if (refused(await handle.stat(), undefined)) {
      throw notRegular(file);
    }
    return await handle.readFile('utf-8');
  } finally {
    await handle.close();
  }
}

function missing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * readRegularFileSync for a caller that asked existsSync first: a path that cannot be stat'ed (missing, a dangling
 * link, a loop) or is not a regular file is null, as existsSync answered; a file found but not readable (EACCES)
 * still throws.
 */
export function readRegularFileSyncOrNull(file: string): string | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  if (!st.isFile()) {
    return null;
  }
  try {
    return readRegularFileSync(file);
  } catch (err) {
    if (missing(err)) return null;
    throw err;
  }
}

/** readRegularFileSyncOrNull, async. */
export async function readRegularFileOrNull(file: string): Promise<string | null> {
  const st = await fs.promises.stat(file).catch(() => null);
  if (st === null || !st.isFile()) {
    return null;
  }
  try {
    return await readRegularFile(file);
  } catch (err) {
    if (missing(err)) return null;
    throw err;
  }
}
