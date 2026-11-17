/**
 * @behavior After a `cd` the gate can't follow (CDPATH set in any form, or a `cd "$VAR"` whose value
 *   is unknown), the folder the command runs in could be a protected folder such as `.oss/tool-gates`.
 *   A write to a bare relative name there (`echo x > x.json`) is refused, for the main agent, a
 *   builder and a review agent without the sandbox, because it could write a protected file.
 * @business-rule R-266 round 10, part B finding: a name only a protected folder's `/**` covers was
 *   allowed after a lost `cd`. A relative write after a lost `cd` is refused when some protected path
 *   ends in a wildcard tail that the name could match. A `cd` to a plain folder is still followed.
 * @boundary runToolGate (the gate as the hook calls it).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('a write to a bare name after a cd the gate cannot follow', () => {
  let root: string;
  let repo: string;

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r10-lost-cd-')));
    repo = path.join(root, 'repo');
    fs.mkdirSync(path.join(repo, '.oss', 'tool-gates'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function call(command: string, agent: string | null, extraEnv: Record<string, string> = {}): Promise<GateResult> {
    const home = process.env.HOME ?? '';
    return runToolGate(
      {
        mode: 'pre',
        input: JSON.stringify({
          session_id: 'r10-lost-cd',
          cwd: repo,
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command },
          ...(agent === null ? {} : { agent_type: agent }),
        }),
        env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir(), ...extraEnv },
        hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
      },
      { platform: 'linux' },
    );
  }

  // Each lands in `.oss/tool-gates` when it runs, and writes the protected `.oss/tool-gates/x.json`.
  const lost = [
    '${CDPATH:=.oss} >/dev/null; cd tool-gates && echo x > x.json',
    'CDPATH=.oss cd tool-gates && echo x > x.json',
    'export CDPATH=.oss; cd tool-gates && echo x > x.json',
    'D=$(printf .oss/tool-gates); cd "$D" && echo x > x.json',
    'D=$(printf .oss/tool-gates); cd "$D" && echo x > .x.json',
    'D=$(printf .oss/tool-gates); cd "$D" && touch x.json',
    'D=$(printf .oss/tool-gates); cd "$D" && cp /tmp/a x.json',
    'D=$(printf .oss/tool-gates); cd "$D" && curl -so x.json https://example.com/x',
    'D=$(printf .oss/tool-gates); cd "$D" && curl -so .x.json https://example.com/x',
    'D=$(printf .oss/tool-gates); cd "$D" && tee x.json < /tmp/a',
    'D=$(printf .oss/tool-gates); cd "$D" && sed -i s/a/b/ x.json',
  ];

  it.each(lost)('refuses the main agent `%s`', async (command) => {
    const result = await call(command, null);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^Refused/);
  });

  it.each(lost)('refuses a builder `%s`', async (command) => {
    const result = await call(command, 'oss:typescript-pro');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^Refused/);
  });

  it.each(lost)('refuses a review agent without the sandbox `%s`', async (command) => {
    const result = await call(command, 'oss:code-reviewer', { OSS_TOOL_GATE_SANDBOX: 'off' });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^Refused/);
  });

  const HINT = 'use the full path, or cd to a plain folder in the same command (`cd src && …`)';

  it.each(['cd "$X" && rm -f build/out.js', 'cd "$X" && echo x > out.txt', 'cd "$X" && curl -so out.json https://example.com/x'])(
    'tells the main agent what to do instead of `%s`',
    async (command) => {
      const result = await call(command, null);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(HINT);
    },
  );

  it.each(['cd src && npm test', 'cd src && echo x > x.json', 'cd .oss && echo x > notes.txt', 'cd src && rm -f build/out.js'])(
    'still allows the main agent `%s` after a cd to a plain folder',
    async (command) => {
      const result = await call(command, null);
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    },
  );
});
