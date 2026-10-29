/**
 * isMainModule — true when the file node was asked to run (argv[1]) is this module.
 *
 * Node usually resolves import.meta.url to the module's REAL path, but keeps the link path under
 * --preserve-symlinks-main, and argv[1] is the path as typed: compare the real paths of both sides.
 * A path that cannot be resolved is never the main module (fail closed).
 */

import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';

export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) {
    return false;
  }
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
