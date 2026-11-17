/**
 * The ONE set of esbuild options for the standalone gate-run bundle.
 * Used by scripts/bundle-cli.js (which writes dist/cli/gate-run.cjs) and by
 * test/hooks/gate-run-dist.test.ts (which checks the committed bundle is current).
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const watcherRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('esbuild').BuildOptions} */
export const GATE_RUN_BUNDLE_OPTIONS = {
  entryPoints: [resolve(watcherRoot, 'src/cli/gate-run.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: resolve(watcherRoot, 'dist/cli/gate-run.cjs'),
  // Pin esbuild's `// src/...` path comments so a build from the repo root gives the same bytes.
  absWorkingDir: watcherRoot,
};
