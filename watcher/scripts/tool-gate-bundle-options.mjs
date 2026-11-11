/**
 * The ONE set of esbuild options for the standalone tool-gate bundle.
 * Used by scripts/bundle-cli.js (which writes dist/cli/tool-gate.cjs) and by
 * test/hooks/tool-gate-dist.test.ts (which checks the committed bundle is current).
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const watcherRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('esbuild').BuildOptions} */
export const TOOL_GATE_BUNDLE_OPTIONS = {
  entryPoints: [resolve(watcherRoot, 'src/cli/tool-gate.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: resolve(watcherRoot, 'dist/cli/tool-gate.cjs'),
  // Pin esbuild's `// src/...` path comments so a build from the repo root gives the same bytes.
  absWorkingDir: watcherRoot,
};
