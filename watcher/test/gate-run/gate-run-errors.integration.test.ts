/**
 * @behavior When the review-run check itself fails (an unreadable gate list, unreadable hook input),
 *   the session is never blocked: the hook exits 0, the user is told the review is unverified, and
 *   one gate-error line is logged in the repo's tool-gate event log.
 * @business-rule AC-008.4 / R-253 crash policy: allow, log, tell; never a silent allow.
 * @boundary runGateRun (watcher/src/gate-run/gate-run.ts), real temp git repo and plugin root
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CHECK_FAILED, runGateRun } from '../../src/gate-run/gate-run.js';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function makeRepo(): string {
  const repo = tempDir('oss-gate-run-err-');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  return repo;
}

function events(repo: string): Array<Record<string, unknown>> {
  const file = path.join(repo, '.oss', 'tool-gates', 'events.ndjson');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('gate-run check failures: allow, log, tell (AC-008.4)', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('a plugin with no readable gate list: exit 0, the user is told, one gate-error is logged', async () => {
    const repo = makeRepo();
    const brokenPlugin = tempDir('oss-gate-run-plugin-');

    const result = await runGateRun({
      event: 'subagent-start',
      input: JSON.stringify({ cwd: repo, hook_event_name: 'SubagentStart', agent_id: 'x1', agent_type: 'oss:code-reviewer' }),
      env: { HOME: os.homedir(), CLAUDE_PLUGIN_ROOT: brokenPlugin },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ systemMessage: CHECK_FAILED });
    expect(events(repo)).toEqual([expect.objectContaining({ tool: 'gate-run', kind: 'gate-error', result: 'allowed' })]);
  });

  it('unreadable hook input: exit 0 and the user is told', async () => {
    const result = await runGateRun({
      event: 'subagent-stop',
      input: 'not json',
      env: { HOME: os.homedir(), CLAUDE_PLUGIN_ROOT: tempDir('oss-gate-run-plugin-') },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ systemMessage: CHECK_FAILED });
  });
});
