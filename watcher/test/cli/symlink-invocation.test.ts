/**
 * CLI symlink invocation Tests — the built CLIs run when node is pointed at a symlink to them
 *
 * @behavior Running `node <link-to-dist/cli/redact-decision.js>` redacts and prints the records it is
 *           given; running `node <link-to-dist/cli/oss-error.js>` with no input reports the error and
 *           exits non-zero. Neither silently prints nothing and exits 0.
 * @business-rule The decision hook commits whatever the redactor prints: a redactor that does nothing
 *                when reached through a link must not look like success.
 * @boundary Built CLIs: watcher/dist/cli/redact-decision.js, watcher/dist/cli/oss-error.js
 *           (run `npm run build` first; these tests exercise the shipped files)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DIST_CLI = path.join(__dirname, '..', '..', 'dist', 'cli');

describe('built CLIs invoked through a symlink', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-symlink-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function linkTo(file: string): string {
    const link = path.join(dir, `linked-${file}`);
    fs.symlinkSync(path.join(DIST_CLI, file), link);
    return link;
  }

  it('redact-decision should print the record it was given', () => {
    const record = { v: 1, id: 'symlink-record', question: 'Which rollout approach?', choice: 'Canary' };

    const result = spawnSync(process.execPath, [linkTo('redact-decision.js')], {
      input: `${JSON.stringify(record)}\n`,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(record);
  });

  it('oss-error should report missing input and exit non-zero', () => {
    const result = spawnSync(process.execPath, [linkTo('oss-error.js')], { input: '', encoding: 'utf-8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('oss-error');
  });
});
