/**
 * The ONE set of esbuild options for the standalone chain-trigger bundle (G8, IRON LAW #1b).
 * Used by scripts/bundle-cli.js (which writes dist/cli/chain-trigger.cjs) and by
 * test/hooks/chain-trigger-dist.test.ts (which checks the committed bundle is current).
 * We use CJS so the shebang works without ESM module parsing issues.
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const watcherRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('esbuild').BuildOptions} */
export const CHAIN_TRIGGER_BUNDLE_OPTIONS = {
  entryPoints: [resolve(watcherRoot, 'src/cli/chain-trigger.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: resolve(watcherRoot, 'dist/cli/chain-trigger.cjs'),
};
