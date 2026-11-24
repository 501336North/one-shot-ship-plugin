/**
 * @behavior The verdict-capture CLI that customers actually run (the COMMITTED bundle
 *           watcher/dist/cli/verdict-capture.cjs, invoked by hooks/oss-verdict-capture.sh (R-257 T19)) is built from the current source.
 * @business-rule A fix to src/cli/verdict-capture.ts (or anything it bundles) is not shipped until the committed bundle
 *           carries it. Customers run what is committed, not src.
 * @boundary esbuild of src/cli/verdict-capture.ts with the options scripts/bundle-cli.js uses.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildSync } from 'esbuild';
import { VERDICT_CAPTURE_BUNDLE_OPTIONS } from '../../scripts/verdict-capture-bundle-options.mjs';

const watcherRoot = path.resolve(__dirname, '../..');
const committedBundle = path.join(watcherRoot, 'dist', 'cli', 'verdict-capture.cjs');

describe('committed verdict-capture bundle', () => {
  it('should match the committed dist/cli/verdict-capture.cjs to a fresh bundle', () => {
    // The very options scripts/bundle-cli.js uses: one copy.
    const fresh = buildSync({ ...VERDICT_CAPTURE_BUNDLE_OPTIONS, write: false, logLevel: 'silent' });
    const freshText = fresh.outputFiles?.[0]?.text;
    const committed = fs.existsSync(committedBundle) ? fs.readFileSync(committedBundle, 'utf8') : null;
    expect(
      committed === freshText,
      'dist/cli/verdict-capture.cjs lags src: run `npm run build:cli-bundle` and commit it',
    ).toBe(true);
  });
});
