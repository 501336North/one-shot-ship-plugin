/**
 * @behavior Round 12, CR L3: the served-blocks fixture generator finds the API checkout from
 *   OSS_API_REPO (else the R-266 worktree path), and never drops the API's blocks from the fixture
 *   when that checkout is missing; the staleness check then says the API blocks were checked against
 *   the fixture only, instead of skipping them silently.
 * @business-rule R-266: every served block stays covered by the served-commands acceptance test, on
 *   any machine.
 * @boundary scripts/served-command-blocks.mjs, called as a module with temp folders.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apiCommandsDir, apiCommandFiles, DEFAULT_API_REPO, fixtureFiles, apiStatus } from '../../scripts/served-command-blocks.mjs';

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

describe('CR L3: the API checkout for the served-blocks fixture', () => {
  it('comes from OSS_API_REPO, else the default worktree path', () => {
    expect(apiCommandsDir({ OSS_API_REPO: '/x/api' })).toBe('/x/api/packages/api/src/prompts/commands');
    expect(apiCommandsDir({})).toBe(path.join(DEFAULT_API_REPO, 'packages/api/src/prompts/commands'));
  });

  it('lists the API files from the checkout named by OSS_API_REPO', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-api-'));
    temps.push(repo);
    fs.mkdirSync(path.join(repo, 'packages/api/src/prompts/commands'), { recursive: true });
    expect(apiCommandFiles({ OSS_API_REPO: repo }).map((f) => f.key)).toContain('api/commands/ship.md');
    expect(apiCommandFiles({ OSS_API_REPO: path.join(repo, 'missing') })).toEqual([]);
  });

  it('keeps the API entries of the old fixture when the API checkout is missing', () => {
    const old = { 'commands/a.md': ['old'], 'api/commands/ship.md': ['echo served'] };
    const files = fixtureFiles(old, { 'commands/a.md': ['new'] }, null);
    expect(files).toEqual({ 'commands/a.md': ['new'], 'api/commands/ship.md': ['echo served'] });
  });

  it('takes the API entries from the checkout when it is there', () => {
    const old = { 'api/commands/ship.md': ['old'] };
    expect(fixtureFiles(old, {}, { 'api/commands/ship.md': ['fresh'] })).toEqual({ 'api/commands/ship.md': ['fresh'] });
  });

  it('says the API blocks were checked against the fixture only when the checkout is missing', () => {
    expect(apiStatus([], { 'api/commands/ship.md': ['x'] })).toBe('API checkout missing; API blocks checked against the fixture only');
    expect(apiStatus([{ key: 'api/commands/ship.md', file: '/x' }], {})).toBeNull();
  });
});
