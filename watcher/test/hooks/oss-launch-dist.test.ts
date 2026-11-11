/**
 * @behavior The committed watcher/dist/cli/oss-launch.cjs (the input the release wraps into the
 *           self-contained binary) is built from the current source and plugin version.
 * @business-rule A plugin build leaves the tracked tree unchanged. A stale bundle is rewritten by
 *           every build, so a review agent that runs the build would void its own review (R-266
 *           tree check), and the binary would report an old version.
 * @boundary esbuild of src/cli/oss-launch.ts with the options scripts/bundle-cli.js uses.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildSync } from 'esbuild';
import { OSS_LAUNCH_BUNDLE_OPTIONS } from '../../scripts/oss-launch-bundle-options.mjs';

const watcherRoot = path.resolve(__dirname, '../..');
const committedBundle = path.join(watcherRoot, 'dist', 'cli', 'oss-launch.cjs');

describe('committed oss-launch bundle', () => {
  it('should match the committed dist/cli/oss-launch.cjs to a fresh bundle', () => {
    const fresh = buildSync({ ...OSS_LAUNCH_BUNDLE_OPTIONS, write: false, logLevel: 'silent' });
    const freshText = fresh.outputFiles?.[0]?.text;
    const committed = fs.existsSync(committedBundle) ? fs.readFileSync(committedBundle, 'utf8') : null;
    expect(
      committed === freshText,
      'dist/cli/oss-launch.cjs lags src or the plugin version: run `npm run build:cli-bundle` and commit it',
    ).toBe(true);
  });
});
