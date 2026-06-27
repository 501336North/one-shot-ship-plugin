#!/usr/bin/env node
/**
 * Bundle CLI tools into standalone files using esbuild.
 *
 * chain-trigger.js needs to work as a standalone file in the published plugin
 * (no relative imports to api/ or engine/ directories). This script bundles
 * it with all dependencies inlined.
 *
 * The output overwrites the tsc-compiled chain-trigger.js so existing
 * references in oss-notify.sh continue to work without changes.
 */

import { buildSync } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watcherRoot = resolve(__dirname, '..');

// Bundle chain-trigger.ts into a standalone CJS file
// We use CJS so the shebang works without ESM module parsing issues
const result = buildSync({
  entryPoints: [resolve(watcherRoot, 'src/cli/chain-trigger.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: resolve(watcherRoot, 'dist/cli/chain-trigger.cjs'),
  write: true,
});

if (result.errors.length > 0) {
  console.error('Bundle failed:', result.errors);
  process.exit(1);
}

// Also create a .js wrapper that re-exports the .cjs bundle
// This ensures backward compatibility with oss-notify.sh resolve_cli
// which looks for chain-trigger.js
const wrapperPath = resolve(watcherRoot, 'dist/cli/chain-trigger.js');
writeFileSync(wrapperPath,
  `#!/usr/bin/env node\n` +
  `// Auto-generated wrapper - delegates to bundled chain-trigger.cjs\n` +
  `import { createRequire } from 'module';\n` +
  `const require = createRequire(import.meta.url);\n` +
  `require('./chain-trigger.cjs');\n`
);

console.log('  Bundled: dist/cli/chain-trigger.cjs (standalone)');
console.log('  Wrapper: dist/cli/chain-trigger.js (ESM compat)');

// Bundle oss-launch into a standalone CJS file. This is the input the runtime-wrap (pkg on native
// runners) turns into a self-contained binary, so a customer box needs NO system Node for local
// routing. It flattens oss-launch's relative imports into one file (static imports → require, which
// pkg's snapshot can execute — dynamic import() cannot). Node built-ins stay external (provided by
// the wrapped runtime). target=node18 to match the pkg base (vercel/pkg tops out at node18).
const ossVersion = JSON.parse(
  readFileSync(resolve(watcherRoot, '..', '.claude-plugin', 'plugin.json'), 'utf-8')
).version;
const launchResult = buildSync({
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
  define: {
    'import.meta.url': '__ossImportMetaUrl',
    __OSS_LAUNCH_VERSION__: JSON.stringify(ossVersion),
    __OSS_BUNDLED__: 'true',
  },
  banner: {
    js: "const __ossImportMetaUrl = require('url').pathToFileURL(__filename).href;",
  },
  write: true,
});

if (launchResult.errors.length > 0) {
  console.error('oss-launch bundle failed:', launchResult.errors);
  process.exit(1);
}

console.log('  Bundled: dist/cli/oss-launch.cjs (standalone — runtime-wrap input)');
