/**
 * The ONE set of esbuild options for the standalone phase-result bundle (R-257 T9).
 * Used by scripts/bundle-cli.js (which writes dist/cli/phase-result.cjs) and by
 * test/cli/phase-result-dist.test.ts (which checks the committed bundle is current).
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const watcherRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('esbuild').BuildOptions} */
export const PHASE_RESULT_BUNDLE_OPTIONS = {
  entryPoints: [resolve(watcherRoot, 'src/cli/phase-result.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: resolve(watcherRoot, 'dist/cli/phase-result.cjs'),
  // Pin esbuild's `// src/...` path comments so a build from the repo root gives the same bytes.
  absWorkingDir: watcherRoot,
};
