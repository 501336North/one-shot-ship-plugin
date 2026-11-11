/**
 * @behavior The tool-gate that customers actually run (the COMMITTED bundle
 *           watcher/dist/cli/tool-gate.cjs, invoked by hooks/oss-tool-gate.sh) is built from
 *           the current source.
 * @business-rule A fix to src/cli/tool-gate.ts (or anything it bundles) is not shipped until
 *           the committed bundle carries it. Customers run what is committed, not src.
 * @boundary esbuild of src/cli/tool-gate.ts with the options scripts/bundle-cli.js uses.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildSync } from 'esbuild';
import { TOOL_GATE_BUNDLE_OPTIONS } from '../../scripts/tool-gate-bundle-options.mjs';

const watcherRoot = path.resolve(__dirname, '../..');
const committedBundle = path.join(watcherRoot, 'dist', 'cli', 'tool-gate.cjs');

describe('committed tool-gate bundle', () => {
  it('should match the committed dist/cli/tool-gate.cjs to a fresh bundle', () => {
    // The very options scripts/bundle-cli.js uses: one copy.
    const fresh = buildSync({ ...TOOL_GATE_BUNDLE_OPTIONS, write: false, logLevel: 'silent' });
    const freshText = fresh.outputFiles?.[0]?.text;
    const committed = fs.existsSync(committedBundle) ? fs.readFileSync(committedBundle, 'utf8') : null;
    expect(
      committed === freshText,
      'dist/cli/tool-gate.cjs lags src: run `npm run build:cli-bundle` and commit it',
    ).toBe(true);
  });
});
