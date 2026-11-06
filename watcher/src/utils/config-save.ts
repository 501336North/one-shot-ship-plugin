/**
 * The one safe read-merge-write of a JSON config the person keeps (T80): ~/.oss/config.json, which holds the OSS
 * apiKey, saved by /oss:models and WebhookConfig. Only a missing file starts from {}; a file that is not a regular
 * file holding a JSON object is refused (NotSaved) and never written, so a save never hangs on a FIFO and never
 * replaces a file it could not read. A link is followed (dotfiles), as the T70c settings.json writers do, and the
 * saved file is owner-only (600) whatever the umask or the mode an older writer left.
 */

import * as fs from 'fs';
import { readRegularFileSync } from './regular-file.js';

const NOT_REGULAR = 'is not a regular file';

/** A save refused: the message says which file and why; nothing was written. */
export class NotSaved extends Error {
  constructor(file: string, why: string) {
    super(`Not saved: ${file} ${why}. Nothing was changed.`);
    this.name = 'NotSaved';
  }
}

/** The JSON object in `file` to merge into, {} when there is no file; throws NotSaved for anything else. */
export function loadConfigForSave(file: string): Record<string, unknown> {
  try {
    if (!fs.statSync(file).isFile()) {
      throw new NotSaved(file, NOT_REGULAR);
    }
  } catch (err) {
    if (err instanceof NotSaved) throw err;
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw new NotSaved(file, 'could not be read');
  }
  let content: string;
  try {
    content = readRegularFileSync(file);
  } catch {
    throw new NotSaved(file, 'could not be read');
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not JSON: refused below
  }
  throw new NotSaved(file, 'is not a valid JSON object. Fix or remove it, then try again');
}

/**
 * Write `config` to `file` (its folder must exist). Opened non-blocking and checked on the open file, so a FIFO or
 * device swapped in since the load is refused (NotSaved) instead of blocking or being written. Created at 600 and
 * fchmod'ed to 600, so neither the umask nor an older mode leaves it readable by others.
 */
export function saveConfigFile(file: string, config: Record<string, unknown>): void {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NONBLOCK, 0o600);
  } catch (err) {
    // ENXIO: a FIFO with no reader (opened non-blocking, so no hang)
    throw new NotSaved(file, (err as NodeJS.ErrnoException).code === 'ENXIO' ? NOT_REGULAR : 'could not be written');
  }
  try {
    if (!fs.fstatSync(fd).isFile()) {
      throw new NotSaved(file, NOT_REGULAR);
    }
    fs.fchmodSync(fd, 0o600);
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, JSON.stringify(config, null, 2));
  } finally {
    fs.closeSync(fd);
  }
}
