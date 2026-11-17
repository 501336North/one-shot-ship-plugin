/**
 * @behavior A named pipe (FIFO) planted where the review-run check writes its log line or its own state
 *   never makes the check hang: start, stop and main-post each end within the hook's time and still tell
 *   the user (and the main agent) the review run is unverified.
 * @business-rule A review agent can plant a FIFO at a path the check appends to; a hung hook would be
 *   killed at its timeout and the main agent never told (security HIGH-2, R-266 round 8). Fail closed, never hang.
 * @boundary the gate-run CLI (src/cli/gate-run.ts, bundled as the hooks run it), in a child process with a timeout
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSync } from 'esbuild';
import { GATE_RUN_BUNDLE_OPTIONS } from '../../scripts/gate-run-bundle-options.mjs';

const tempDirs: string[] = [];
let cli = '';

function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function makeRepo(): string {
  const repo = tempDir('oss-gate-run-fifo-');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  return repo;
}

function fifo(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync('/usr/bin/mkfifo', [file]);
}

/** Runs the CLI as the hook does; a hang is cut at 15 s (status null). */
function runCli(home: string, event: string, hook: object): { status: number | null; stdout: string } {
  const result = spawnSync(process.execPath, [cli, event], {
    input: JSON.stringify(hook),
    env: { PATH: process.env.PATH, HOME: home, CLAUDE_PLUGIN_ROOT: path.resolve(__dirname, '../../..') },
    encoding: 'utf8',
    timeout: 15000,
  });
  return { status: result.status, stdout: result.stdout };
}

describe('a FIFO where the check writes never hangs it (security HIGH-2)', () => {
  beforeAll(() => {
    cli = path.join(tempDir('oss-gate-run-cli-'), 'gate-run.cjs');
    buildSync({ ...GATE_RUN_BUNDLE_OPTIONS, outfile: cli, logLevel: 'silent' });
  });
  afterAll(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it("a FIFO at the repo's tool-gate event log: a stop that logs a gate-error ends and says unverified", () => {
    const repo = makeRepo();
    const home = tempDir('oss-gate-run-fifo-home-');
    fifo(path.join(repo, '.oss', 'tool-gates', 'events.ndjson'));
    const hook = { session_id: 's1', cwd: repo, agent_id: 'f1', agent_type: 'oss:code-reviewer', hook_event_name: 'SubagentStop' };

    const stop = runCli(home, 'subagent-stop', hook);

    expect(stop.status).toBe(0);
    expect(stop.stdout).toMatch(/unverified/i);
  });

  it("a FIFO at each of the session's state files: start, stop and main-post end and say unverified", () => {
    const repo = makeRepo();
    const home = tempDir('oss-gate-run-fifo-home-');
    const session = path.join(home, '.oss', 'gate-state', 's2');
    fifo(path.join(repo, '.oss', 'tool-gates', 'events.ndjson'));
    for (const name of ['agents.seen', 'f2.started', 'f2.done', 'f2.tamper', 'f2.start-failed', 'f2.snap.json', 'f2.1.notice.json']) {
      fifo(path.join(session, name));
    }
    const hook = { session_id: 's2', cwd: repo, agent_id: 'f2', agent_type: 'oss:code-reviewer' };

    const start = runCli(home, 'subagent-start', { ...hook, hook_event_name: 'SubagentStart' });
    const stop = runCli(home, 'subagent-stop', { ...hook, hook_event_name: 'SubagentStop' });
    const main = runCli(home, 'main-post', { session_id: 's2', cwd: repo, hook_event_name: 'PostToolUse', tool_name: 'Bash' });

    for (const result of [start, stop, main]) {
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/unverified|could not run/i);
    }
  });
});
