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
