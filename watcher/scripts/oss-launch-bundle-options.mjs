/**
 * The ONE set of esbuild options for the standalone oss-launch bundle (the input pkg wraps into the
 * self-contained binary). Used by scripts/bundle-cli.js (which writes dist/cli/oss-launch.cjs) and by
 * test/cli/oss-launch-bundled-proxy.test.ts (which runs that bundle as the binary would, T89).
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const watcherRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ossVersion = JSON.parse(
  readFileSync(resolve(watcherRoot, '..', '.claude-plugin', 'plugin.json'), 'utf-8')
).version;

/** @type {import('esbuild').BuildOptions} */
export const OSS_LAUNCH_BUNDLE_OPTIONS = {
  entryPoints: [resolve(watcherRoot, 'src/cli/oss-launch.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: resolve(watcherRoot, 'dist/cli/oss-launch.cjs'),
  // In a CJS bundle `import.meta.url` does not exist. Map it to a banner-declared identifier that
  // computes a __filename-based file URL, so the launcher's self-path / main-module detection works
  // in the bundled binary too. (esbuild `define` values must be an identifier or JSON, not an
  // expression — hence the banner.) Also embed the version — a relocated binary can't read plugin.json.
  // __OSS_BUNDLED__ applies to every bundled module (oss-launch.ts and start-proxy.ts alike).
  define: {
    'import.meta.url': '__ossImportMetaUrl',
    __OSS_LAUNCH_VERSION__: JSON.stringify(ossVersion),
    __OSS_BUNDLED__: 'true',
  },
  banner: {
    js: "const __ossImportMetaUrl = require('url').pathToFileURL(__filename).href;",
  },
};
