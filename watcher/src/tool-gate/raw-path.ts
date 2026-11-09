/**
 * Joins a path onto a base directory as text, without collapsing `..`. `link/..` is the parent
 * of where `link` points, which only the disk knows (see path-resolver.ts), so a `..` after a
 * folder name is kept. `.` segments and doubled slashes are dropped, and so is a `..` right at
 * the top of the file system, where the disk treats it as the top itself.
 */
export function joinRaw(base: string, p: string): string {
  const segments: string[] = [];
  for (const segment of (p.startsWith('/') ? p : `${base}/${p}`).split('/')) {
    if (segment === '' || segment === '.' || (segment === '..' && segments.length === 0)) continue;
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}
