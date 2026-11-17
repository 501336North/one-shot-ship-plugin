/**
 * @behavior Building the plugin never rewrites a tracked file through the oss-launch bundle,
 *           whatever the plugin version.
 * @business-rule The oss-launch bundle embeds the plugin version and ships only inside the binary,
 *           which .github/workflows/build-oss-launch.yml builds from source. A committed copy goes
 *           stale on every version bump, so a review agent that runs the build would see the repo
 *           change and void its own review (R-266). The bundle is build output, never committed.
 * @boundary git: the bundle's output path, as scripts/bundle-cli.js writes it.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { OSS_LAUNCH_BUNDLE_OPTIONS } from '../../scripts/oss-launch-bundle-options.mjs';

const watcherRoot = path.resolve(__dirname, '../..');
const outfile = String(OSS_LAUNCH_BUNDLE_OPTIONS.outfile);
const git = (...args: string[]) => spawnSync('git', args, { cwd: watcherRoot, encoding: 'utf8' });

describe('oss-launch bundle is build output', () => {
  it('is not tracked, so a build at any plugin version leaves the tracked tree unchanged', () => {
    expect(git('ls-files', '--error-unmatch', outfile).status, `${outfile} is tracked`).not.toBe(0);
  });

  it('is ignored, so a build does not leave it as a new untracked file either', () => {
    expect(git('check-ignore', '-q', '--no-index', outfile).status, `${outfile} is not ignored`).toBe(0);
  });
});
