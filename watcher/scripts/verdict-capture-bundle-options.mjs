/**
 * The ONE set of esbuild options for the standalone verdict-capture bundle (R-257 T19).
 * Used by scripts/bundle-cli.js (which writes dist/cli/verdict-capture.cjs) and by
 * test/cli/verdict-capture-dist.test.ts (which checks the committed bundle is current).
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const watcherRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('esbuild').BuildOptions} */
export const VERDICT_CAPTURE_BUNDLE_OPTIONS = {
  entryPoints: [resolve(watcherRoot, 'src/cli/verdict-capture.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: resolve(watcherRoot, 'dist/cli/verdict-capture.cjs'),
  // Pin esbuild's `// src/...` path comments so a build from the repo root gives the same bytes.
  absWorkingDir: watcherRoot,
};
