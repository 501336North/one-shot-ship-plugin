/**
 * @behavior The phase-result CLI that customers actually run (the COMMITTED bundle
 *           watcher/dist/cli/phase-result.cjs, invoked by hooks/oss-phase-result.sh) is built from the current source.
 * @business-rule A fix to src/cli/phase-result.ts (or anything it bundles) is not shipped until the committed bundle
 *           carries it. Customers run what is committed, not src.
 * @boundary esbuild of src/cli/phase-result.ts with the options scripts/bundle-cli.js uses.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildSync } from 'esbuild';
import { PHASE_RESULT_BUNDLE_OPTIONS } from '../../scripts/phase-result-bundle-options.mjs';

const watcherRoot = path.resolve(__dirname, '../..');
const committedBundle = path.join(watcherRoot, 'dist', 'cli', 'phase-result.cjs');

describe('committed phase-result bundle', () => {
  it('should match the committed dist/cli/phase-result.cjs to a fresh bundle', () => {
    // The very options scripts/bundle-cli.js uses: one copy.
    const fresh = buildSync({ ...PHASE_RESULT_BUNDLE_OPTIONS, write: false, logLevel: 'silent' });
    const freshText = fresh.outputFiles?.[0]?.text;
    const committed = fs.existsSync(committedBundle) ? fs.readFileSync(committedBundle, 'utf8') : null;
    expect(
      committed === freshText,
      'dist/cli/phase-result.cjs lags src: run `npm run build:cli-bundle` and commit it',
    ).toBe(true);
  });
});
