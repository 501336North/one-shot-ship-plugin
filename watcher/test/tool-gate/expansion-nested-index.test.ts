/**
 * @behavior A CDPATH (or zsh cdpath) set hidden behind a nested array index, `${CDPATH[${X[0]}]:=/d}`
 *   (bash) or `${cdpath[${X[1]:-1}]:=/d}` (zsh), still counts as a set of CDPATH, so a `cd` after it is
 *   treated as lost: a review agent without the sandbox and the main agent can't use it to write a
 *   protected file such as `.oss/tool-gates/x.json` or `.git/hooks/pre-commit`.
 * @business-rule R-266 round 10, CR HIGH-1: an index the gate can't read in full (it holds `$`, a
 *   backtick or `[`) is taken as the risky case (fail closed).
 * @boundary expansionSet (expansion-scan.ts), readCommand (command-reader.ts) and the gate (runToolGate).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expansionSet } from '../../src/tool-gate/expansion-scan.js';
import { readCommand } from '../../src/tool-gate/command-reader.js';
import { runToolGate, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const isCdpath = (name: string): boolean => name === 'CDPATH' || name === 'cdpath';

const NESTED: Array<[string, string]> = [
  ['bash nested index', '${CDPATH[${X[0]}]:=/d}'],
  ['zsh nested index with a default', '${cdpath[${X[1]:-1}]:=/d}'],
  ['index with a backtick', '${CDPATH[`echo 0`]:=/d}'],
  ['index with a plain variable', '${CDPATH[$i]=/d}'],
  ['arithmetic with a nested index', '((CDPATH[${X[0]}]=1))'],
];

describe('a set of CDPATH behind an index the gate cannot read', () => {
  it.each(NESTED)('counts the %s as a set of CDPATH', (_name, text) => {
    expect(expansionSet(`echo ${text}`, isCdpath)).not.toBeNull();
  });

  it.each(['${X[${Y[0]}]:=/d}', '${CDPATH[0]}', '${CDPATH}', '((a[$i]=1))'])('finds no CDPATH set in %s', (text) => {
    expect(expansionSet(text, isCdpath)).toBeNull();
  });

  it.each(NESTED)('reads `cd` after the %s as lost', (_name, text) => {
    const read = readCommand(`echo ${text}; cd hooks && echo x > pre-commit`, '/w', '/h');
    const parts = 'parts' in read ? read.parts : [];
    expect(parts.at(-1)?.lostDir).not.toBeNull();
  });
});

describe('the gate refuses a write through a nested-index CDPATH set', () => {
  let root: string;
  let repo: string;

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r10-nested-')));
    repo = path.join(root, 'repo');
    fs.mkdirSync(path.join(repo, 'dev', '.oss', 'tool-gates'), { recursive: true });
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
          session_id: 'r10-nested',
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

  // Followed, `cd dev` writes `dev/.oss/tool-gates/x.json` (not protected); through a CDPATH the `cd`
  // could land in the repo root, where it is the protected `.oss/tool-gates/x.json`, so it must be lost.
  const commands = [
    'echo ${CDPATH[${X[0]}]:=/}; cd dev && echo {} > .oss/tool-gates/x.json',
    'echo ${cdpath[${X[1]:-1}]:=/}; cd dev && echo {} > .oss/tool-gates/x.json',
  ];

  it.each(commands)('refuses the main agent `%s`', async (command) => {
    const result = await call(command, null);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^Refused/);
  });

  // A review agent may run nothing in a folder only known when it runs: CDPATH could take it out of the repo.
  it.each([
    ...commands,
    'echo ${CDPATH[${X[0]}]:=/x}; cd dev && ls',
    'echo ${cdpath[${X[1]:-1}]:=/x}; cd dev && ls',
  ])('refuses a review agent without the sandbox `%s`', async (command) => {
    const result = await call(command, 'oss:code-reviewer', { OSS_TOOL_GATE_SANDBOX: 'off' });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^Refused/);
  });

  it('still allows a review agent without the sandbox `cd dev && ls`', async () => {
    const result = await call('cd dev && ls', 'oss:code-reviewer', { OSS_TOOL_GATE_SANDBOX: 'off' });
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('still allows the main agent the same write after a plain `cd`', async () => {
    const result = await call('cd dev && echo {} > .oss/tool-gates/x.json', null);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });
});

/**
 * @behavior CDPATH (or zsh's cdpath) set by a plain assignment whose index is itself indexed
 *   (`CDPATH[X[0]]=.git`), appended to that way, or by a zsh expansion with flags before the name
 *   (`${(A)cdpath::=…}`), is read as a set of CDPATH to an unknown value: a `cd` after it is lost.
 * @business-rule R-266 round 11, CR HIGH-B: fail closed for main, builder and review fallback.
 * @boundary expansionSet (expansion-scan.ts), readCommand (command-reader.ts) and the gate.
 */
describe('a set of CDPATH through a nested index or zsh flags', () => {
  const FORMS = [
    'X=(0); CDPATH[X[0]]=/',
    'X=(0); CDPATH[X[0]]+=/',
    'X=(1); cdpath[X[1]]=/',
    ': ${(A)cdpath::=/}',
    ': ${(A)CDPATH:=/}',
  ];

  it.each([': ${(A)cdpath::=/}', ': ${(P)CDPATH=/}'])('counts %s as a set of CDPATH', (text) => {
    expect(expansionSet(text, isCdpath)).not.toBeNull();
  });

  it.each(FORMS)('reads `cd` after `%s` as lost', (form) => {
    const read = readCommand(`${form}; cd dev && echo x > .oss/tool-gates/x.json`, '/w', '/h');
    const parts = 'parts' in read ? read.parts : [];
    expect(parts.at(-1)?.lostDir).not.toBeNull();
  });

  describe('through the gate', () => {
    let root: string;
    let repo: string;

    beforeAll(() => {
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-r11-nested-')));
      repo = path.join(root, 'repo');
      fs.mkdirSync(path.join(repo, 'dev', '.oss', 'tool-gates'), { recursive: true });
      execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
    });

    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    const call = (command: string, agent: string | null, extraEnv: Record<string, string> = {}): Promise<GateResult> => {
      const home = process.env.HOME ?? '';
      return runToolGate(
        {
          mode: 'pre',
          input: JSON.stringify({ session_id: 'r11-nested', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...(agent === null ? {} : { agent_type: agent }) }),
          env: { HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir(), ...extraEnv },
          hookEnv: { PATH: '/usr/bin:/bin', HOME: home },
        },
        { platform: 'linux' },
      );
    };

    const cases = FORMS.flatMap((form) => [
      [form, null],
      [form, 'oss:typescript-pro'],
      [form, 'oss:code-reviewer'],
    ] as Array<[string, string | null]>);

    it.each(cases)('refuses `%s; cd dev && echo …` for %s', async (form, agent) => {
      const result = await call(`${form}; cd dev && echo {} > .oss/tool-gates/x.json`, agent, { OSS_TOOL_GATE_SANDBOX: 'off' });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/^Refused/);
    });
  });
});
