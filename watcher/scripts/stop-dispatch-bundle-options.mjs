/**
 * The ONE set of esbuild options for the standalone stop-dispatch bundle (R-257 T11).
 * Used by scripts/bundle-cli.js (which writes dist/cli/stop-dispatch.cjs) and by
 * hooks/oss-stop-dispatch.sh (which runs it).
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const watcherRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('esbuild').BuildOptions} */
export const STOP_DISPATCH_BUNDLE_OPTIONS = {
  entryPoints: [resolve(watcherRoot, 'src/cli/stop-dispatch.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: resolve(watcherRoot, 'dist/cli/stop-dispatch.cjs'),
  // Pin esbuild's `// src/...` path comments so a build from the repo root gives the same bytes.
  absWorkingDir: watcherRoot,
};
