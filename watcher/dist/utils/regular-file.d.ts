/**
 * The one hang-safe way the watcher reads a file a user or a repo can write (T70e): ~/.oss, a project's .oss,
 * ~/.claude, tmp, logs. The path is stat'ed first (links followed) and anything but a regular file is refused
 * without being opened, so a device is never opened (round 2). The file is then opened non-blocking, so a FIFO
 * swapped in never blocks the open, and checked with fstat on that open file, so it cannot be swapped between the
 * check and the read. Anything but a regular file (a FIFO,
 * a device, a folder), and with `owner` a file someone else owns, throws ENOENT: each caller already handles a
 * missing file, so that is how it treats these.
 */
/** readFileSync(file, 'utf-8') for a regular file only (and, with `owner`, only one that uid owns). */
export declare function readRegularFileSync(file: string, owner?: number): string;
/** fs.promises.readFile(file, 'utf-8') for a regular file only. */
export declare function readRegularFile(file: string): Promise<string>;
/**
 * readRegularFileSync for a caller that asked existsSync first: a path that cannot be stat'ed (missing, a dangling
 * link, a loop) or is not a regular file is null, as existsSync answered; a file found but not readable (EACCES)
 * still throws.
 */
export declare function readRegularFileSyncOrNull(file: string): string | null;
/** readRegularFileSyncOrNull, async. */
export declare function readRegularFileOrNull(file: string): Promise<string | null>;
//# sourceMappingURL=regular-file.d.ts.map