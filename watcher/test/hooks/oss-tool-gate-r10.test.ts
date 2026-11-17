/**
 * @behavior Round 10 changes to hooks/oss-tool-gate.sh:
 *   - PERF MEDIUM-2: a Read, Grep or Glob call from the main agent or a builder is allowed at once,
 *     without starting node. A review agent's, or one whose agent the hook can't tell for sure, still
 *     goes to the gate.
 *   - SEC INFO-1: on macOS a review agent's Bash call the gate allows must come back rewritten to run
 *     in the review sandbox (updatedInput), or say it runs outside it on purpose; a bare allow is refused.
 *   - SEC INFO-2: the gate's answer is never kept in TMPDIR: when the hook's own folder under ~/.oss
 *     can't be used, the gate runs in the foreground.
 * @business-rule R-266: a review agent may not change what it judges; every other agent's reads stay fast.
 * @boundary hooks/oss-tool-gate.sh, run for real against a temp plugin root whose
 *   watcher/dist/cli/tool-gate.cjs is a stub that records it ran and answers as the test says.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WRAPPER = path.join(__dirname, '../../../hooks/oss-tool-gate.sh');
const NODE_DIR = path.dirname(process.execPath);
const REAL_NODE = fs.realpathSync(process.execPath);

// Records that it ran (STUB_RAN), says how its stdout is connected, then answers STUB_OUT / STUB_EXIT.
const STUB_CLI = `
const fs = require('fs');
fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.STUB_RAN, 'ran\\n');
const kind = fs.fstatSync(1).isFile() ? 'file' : 'pipe';
fs.appendFileSync(process.env.STUB_RAN, 'stdout:' + kind + '\\n');
process.stdout.write(process.env.STUB_OUT || '');
process.exitCode = Number(process.env.STUB_EXIT || '0');
`;

let caseRoot: string;
let pluginRoot: string;
let project: string;
let home: string;
let ran: string;
let temp: string;

beforeEach(() => {
  caseRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-tool-gate-r10-')));
  pluginRoot = path.join(caseRoot, 'plugin');
  project = path.join(caseRoot, 'project');
  home = path.join(caseRoot, 'home');
  temp = path.join(caseRoot, 'T');
  ran = path.join(caseRoot, 'ran.txt');
  fs.mkdirSync(path.join(pluginRoot, 'watcher/dist/cli'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'watcher/dist/cli/tool-gate.cjs'), STUB_CLI);
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  fs.mkdirSync(path.join(home, '.oss'), { recursive: true });
  fs.mkdirSync(temp);
  fs.writeFileSync(path.join(home, '.oss', 'node-path'), `${REAL_NODE}\n`, { mode: 0o600 });
});

afterEach(() => {
  fs.rmSync(caseRoot, { recursive: true, force: true });
});

interface Answer {
  status: number | null;
  stdout: string;
  stderr: string;
  gateRan: boolean;
  gateStdout: string | null;
}

function runHook(input: string, opts: { out?: string; exit?: number; env?: Record<string, string> } = {}): Answer {
  const result = spawnSync('/bin/bash', [WRAPPER, 'pre'], {
    input,
    env: {
      HOME: home,
      PATH: `${NODE_DIR}:/usr/bin:/bin`,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      TMPDIR: temp,
      STUB_RAN: ran,
      STUB_OUT: opts.out ?? '',
      STUB_EXIT: String(opts.exit ?? 0),
      ...opts.env,
    },
    cwd: project,
    encoding: 'utf8',
    timeout: 15_000,
  });
  const log = fs.existsSync(ran) ? fs.readFileSync(ran, 'utf8') : '';
  fs.rmSync(ran, { force: true });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, gateRan: log.includes('ran'), gateStdout: /stdout:(\w+)/.exec(log)?.[1] ?? null };
}

function call(tool: string, agent: Record<string, unknown> = {}, toolInput: Record<string, unknown> = { file_path: '/x/README.md' }): string {
  return JSON.stringify({ session_id: 's-1', cwd: project, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput, ...agent });
}

const BUILDER = { agent_type: 'oss:typescript-pro', agent_id: 'a-1' };
const REVIEWER = { agent_type: 'oss:code-reviewer', agent_id: 'a-2' };

describe('PERF MEDIUM-2: Read, Grep and Glob from the main agent or a builder skip node', () => {
  it.each([
    ['Read', {}],
    ['Grep', {}],
    ['Glob', {}],
    ['Read', BUILDER],
    ['Grep', BUILDER],
    ['Glob', { agent_type: 'Explore', agent_id: 'a-3' }],
  ])('allows a %s call (%j) at once, with no output and without running the gate', (tool, agent) => {
    const answer = runHook(call(tool, agent));
    expect(answer.status).toBe(0);
    expect(answer.stdout).toBe('');
    expect(answer.gateRan).toBe(false);
  });

  it.each([
    ['a review agent', call('Read', REVIEWER)],
    ['a review agent in other letter case', call('Grep', { agent_type: 'OSS:Security-Auditor', agent_id: 'a-4' })],
    ['an agent id with no agent type', call('Read', { agent_id: 'a-5' })],
    ['an agent type written with an escape', call('Read', { agent_type: 'AGENT', agent_id: 'a-6' }).replace('AGENT', 'oss:code\\u002dreviewer')],
    ['an agent type that is not a string', call('Read', { agent_type: null, agent_id: 'a-7' })],
    ['two agent types', `{"agent_type":"oss:typescript-pro",${call('Read', REVIEWER).slice(1)}`],
    ['two tool names', `{"tool_name":"Read",${call('Bash', {}, { command: 'echo x' }).slice(1)}`],
    ['a tool name written with an escape', call('Read').replace('"Read"', '"R\\u0065ad"')],
    ['a Bash call from the main agent', call('Bash', {}, { command: 'echo x' })],
    ['an Edit call from a builder', call('Edit', BUILDER, { file_path: '/x/a.ts', old_string: 'a', new_string: 'b' })],
  ])('still runs the gate for %s', (_name, input) => {
    expect(runHook(input).gateRan).toBe(true);
  });
});

describe('SEC INFO-1: a review agent\'s Bash call allowed without the sandbox on macOS', () => {
  const bash = call('Bash', REVIEWER, { command: 'git status' });
  const wrapped = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { command: '/usr/bin/sandbox-exec -p x git status' } } });
  // the gate's one fixed note (gate.ts OUTSIDE_SANDBOX_NOTE), as the whole answer (round 10)
  const NOTE = 'This command runs outside the review sandbox.';
  const outside = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: NOTE } });

  it.runIf(process.platform === 'darwin')('is refused when the gate allows it with no rewrite and no reason', () => {
    const answer = runHook(bash, { out: '' });
    expect(answer.status).toBe(2);
    expect(answer.stderr).toMatch(/^Refused/);
  });

  it.runIf(process.platform === 'darwin')('is refused when the gate\'s answer holds some other JSON', () => {
    expect(runHook(bash, { out: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"x"}}\n' }).status).toBe(2);
  });

  it('is allowed when it comes back rewritten to run in the sandbox', () => {
    const answer = runHook(bash, { out: `${wrapped}\n` });
    expect(answer.status).toBe(0);
    expect(answer.stdout).toContain('updatedInput');
  });

  it('is allowed when the gate says it runs outside the sandbox on purpose', () => {
    expect(runHook(bash, { out: `${outside}\n` }).status).toBe(0);
  });

  it.runIf(process.platform === 'darwin')('is refused when the note is only part of the answer (text a call could get echoed into it)', () => {
    const near = [
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `rule file: /r/${NOTE}` } }),
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `${NOTE} /x` } }),
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'This command runs outside the review sandbox: it is one of your own setup steps.' } }),
      JSON.stringify({ systemMessage: `"additionalContext":"${NOTE}"`, hookSpecificOutput: { hookEventName: 'PreToolUse' } }),
      `${outside}${outside}`,
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'see "updatedInput" in /tmp/x' } }),
    ];
    for (const out of near) expect(runHook(bash, { out: `${out}\n` }).status, out).toBe(2);
  });

  it('is allowed rewritten with the sandbox context after the rewrite', () => {
    const withContext = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { command: '/usr/bin/sandbox-exec -p x git status' }, additionalContext: 'in the sandbox' } });
    expect(runHook(bash, { out: `${withContext}\n` }).status).toBe(0);
  });

  it('is allowed bare when the session turned the sandbox off (OSS_TOOL_GATE_SANDBOX=off)', () => {
    expect(runHook(bash, { out: '', env: { OSS_TOOL_GATE_SANDBOX: 'off' } }).status).toBe(0);
  });

  it('leaves a builder\'s and the main agent\'s bare allow as it is', () => {
    expect(runHook(call('Bash', BUILDER, { command: 'git status' })).status).toBe(0);
    expect(runHook(call('Bash', {}, { command: 'git status' })).status).toBe(0);
  });
});

describe('SEC INFO-2: the gate\'s answer is never kept in TMPDIR', () => {
  it('keeps it in the hook\'s own folder under ~/.oss when it can', () => {
    expect(runHook(call('Bash', {}, { command: 'echo x' })).gateStdout).toBe('file');
  });

  it('runs the gate in the foreground when ~/.oss/gate-state is a link (round 15, CR I2: the folder of the answer), and writes nothing to TMPDIR', () => {
    const elsewhere = path.join(caseRoot, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(home, '.oss', 'gate-state'));
    const before = fs.readdirSync(temp);
    const answer = runHook(call('Bash', {}, { command: 'echo x' }));
    expect(answer.status).toBe(0);
    expect(answer.gateStdout).toBe('pipe');
    expect(fs.readdirSync(temp)).toEqual(before);
  });
});
