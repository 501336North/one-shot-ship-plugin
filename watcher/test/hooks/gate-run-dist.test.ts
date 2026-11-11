/**
 * @behavior The review-run check that customers actually run (the COMMITTED bundle
 *           watcher/dist/cli/gate-run.cjs, invoked by hooks/oss-gate-run.sh) is built from the
 *           current source.
 * @business-rule A fix to src/cli/gate-run.ts (or anything it bundles) is not shipped until the
 *           committed bundle carries it. Customers run what is committed, not src.
 * @boundary esbuild of src/cli/gate-run.ts with the options scripts/bundle-cli.js uses.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildSync } from 'esbuild';
import { GATE_RUN_BUNDLE_OPTIONS } from '../../scripts/gate-run-bundle-options.mjs';

const watcherRoot = path.resolve(__dirname, '../..');
const committedBundle = path.join(watcherRoot, 'dist', 'cli', 'gate-run.cjs');

describe('committed gate-run bundle', () => {
  it('should match the committed dist/cli/gate-run.cjs to a fresh bundle', () => {
    const fresh = buildSync({ ...GATE_RUN_BUNDLE_OPTIONS, write: false, logLevel: 'silent' });
    const freshText = fresh.outputFiles?.[0]?.text;
    const committed = fs.existsSync(committedBundle) ? fs.readFileSync(committedBundle, 'utf8') : null;
    expect(
      committed === freshText,
      'dist/cli/gate-run.cjs lags src: run `npm run build:cli-bundle` and commit it',
    ).toBe(true);
  });

  it('is run by bundle-cli.js', () => {
    expect(fs.readFileSync(path.join(watcherRoot, 'scripts', 'bundle-cli.js'), 'utf8')).toContain('GATE_RUN_BUNDLE_OPTIONS');
  });
});
