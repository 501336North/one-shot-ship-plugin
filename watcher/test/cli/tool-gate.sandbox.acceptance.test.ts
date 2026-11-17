/**
 * @behavior A review agent's Bash call that passes the gate is sent back rewritten to run inside the
 *   OS sandbox (macOS), and allowed without a prompt; a builder's or the main agent's call is never
 *   rewritten. A review agent's Monitor call (which would run outside the sandbox) is refused. Where
 *   no sandbox can be used, review agents get stricter rules: no inline code, no scripts from temp.
 * @business-rule R-266 round 8, user decisions D1 (sandbox), D2 (auto-allow), D4 (fallback).
 * @boundary the real hook (hooks/oss-tool-gate.sh running the committed bundle) for the wrapping,
 *   Monitor and the forced fallback; runToolGate (gate.ts) for the fallback rule table.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTSIDE_SANDBOX_NOTE, runToolGate, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HOOK = path.join(PLUGIN_ROOT, 'hooks/oss-tool-gate.sh');
const ON_MAC = process.platform === 'darwin';
/** The test run's own temp HOME (test/setup.ts), never the user's. */
const HOME = process.env.HOME ?? '';
/** This run's own session: the hook makes its private folder under the real user temp folder, removed in afterAll. */
const SESSION = `sbx-accept-${process.pid}-${Date.now()}`;

let caseRoot: string;
let repo: string;

beforeAll(() => {
  caseRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-sbx-accept-')));
  repo = path.join(caseRoot, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'check.sh'), 'echo ok\n');
  fs.mkdirSync(path.join(HOME, '.oss'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.oss', 'node-path'), `${fs.realpathSync(process.execPath)}\n`, { mode: 0o600 });
});

afterAll(() => {
  fs.rmSync(caseRoot, { recursive: true, force: true });
  // only this run's session folder: other sessions may be using oss-review
  if (ON_MAC) fs.rmSync(path.join(realUserTemp(), 'oss-review', SESSION), { recursive: true, force: true });
});

function realUserTemp(): string {
  return fs.realpathSync(execFileSync('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' }).trim());
}

interface HookAnswer {
  status: number | null;
  stdout: string;
  stderr: string;
}

function hook(input: object, extraEnv: Record<string, string> = {}): HookAnswer {
  const run = spawnSync('/bin/bash', [HOOK, 'pre'], {
    input: JSON.stringify(input),
    env: { HOME, PATH: '/usr/bin:/bin', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir(), ...extraEnv },
    cwd: repo,
    encoding: 'utf8',
    timeout: 15_000,
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function bash(command: string, agent?: string, extra: Record<string, unknown> = {}): object {
  return {
    session_id: SESSION,
    cwd: repo,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command, description: 'look', timeout: 60000, run_in_background: false, ...extra },
    ...(agent === undefined ? {} : { agent_type: agent, agent_id: 'a1' }),
  };
}

function updatedInput(answer: HookAnswer): Record<string, unknown> | null {
  if (answer.stdout.trim() === '') return null;
  const parsed = JSON.parse(answer.stdout) as { hookSpecificOutput?: { permissionDecision?: string; updatedInput?: Record<string, unknown> } };
  expect(parsed.hookSpecificOutput?.permissionDecision).toBe('allow');
  return parsed.hookSpecificOutput?.updatedInput ?? null;
}

/** Runs a rewritten call the way Claude Code's shell would. */
function runWrapped(command: string): { status: number | null; out: string } {
  const run = spawnSync('/bin/bash', ['-c', command], { cwd: repo, encoding: 'utf8', env: { HOME, PATH: '/usr/bin:/bin', TMPDIR: os.tmpdir() } });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

describe.runIf(ON_MAC)("the real hook wraps a review agent's Bash call in the sandbox (macOS)", () => {
  it('returns the call rewritten to run under sandbox-exec, keeping every other field, and allows it', () => {
    const answer = hook(bash('git status --short', 'oss:code-reviewer'));

    expect(answer.status).toBe(0);
    const input = updatedInput(answer);
    expect(String(input?.command)).toMatch(/^\/usr\/bin\/sandbox-exec -p '/);
    expect(input).toMatchObject({ description: 'look', timeout: 60000, run_in_background: false });
  });

  it('runs the rewritten call: reading works, a write to its private temp folder works, a write elsewhere in temp or to the repo is refused', () => {
    // round 9 (D-R9-1), round 10 (D-R10-2): the only writable place is the agent's own private folder under the user temp folder
    const own = path.join(realUserTemp(), 'oss-review', SESSION, 'a1');
    const answer = hook(bash(`git status --short; echo x > '${own}/ok.txt'`, 'oss:security-auditor'));
    expect(runWrapped(String(updatedInput(answer)?.command)).status).toBe(0);
    expect(fs.readFileSync(path.join(own, 'ok.txt'), 'utf8')).toBe('x\n');
    fs.rmSync(path.join(own, 'ok.txt'));
    const scratch = path.join(caseRoot, 'scratch');
    fs.mkdirSync(scratch, { recursive: true });
    const elsewhere = hook(bash(`echo x > '${scratch}/no.txt'`, 'oss:security-auditor'));
    expect(runWrapped(String(updatedInput(elsewhere)?.command)).status).not.toBe(0);
    expect(fs.existsSync(path.join(scratch, 'no.txt'))).toBe(false);

    // a write the gate can't see (inline code) is stopped by the sandbox
    const inline = hook(bash(`python3 -c "open('${repo}/planted.txt','w').write('x')"`, 'oss:performance-auditor'));
    expect(inline.status).toBe(0);
    runWrapped(String(updatedInput(inline)?.command));
    expect(fs.existsSync(path.join(repo, 'planted.txt'))).toBe(false);
  });

  it("never rewrites a builder's or the main agent's call", () => {
    for (const agent of ['oss:typescript-pro', undefined]) {
      const answer = hook(bash('git status --short', agent));
      expect(answer.status).toBe(0);
      expect(answer.stdout).not.toContain('updatedInput');
      expect(answer.stdout).not.toContain('permissionDecision');
    }
  });
});

describe("the real hook refuses a review agent's Monitor call", () => {
  it('refuses Monitor by name, and a Monitor call that arrives as Bash, for review agents only', () => {
    const monitor = { ...bash('tail -f x.log', 'oss:code-reviewer'), tool_name: 'Monitor', tool_input: { command: 'tail -f x.log', description: 'm', timeout_ms: 60000 } };
    const asBash = { ...monitor, tool_name: 'Bash' };
    for (const input of [monitor, asBash]) {
      const answer = hook(input);
      expect(answer.status).toBe(2);
      expect(answer.stderr).toContain('Monitor');
    }
    expect(hook({ ...monitor, agent_type: 'oss:typescript-pro' }).status).toBe(0);
  });
});

describe('the real hook with the sandbox turned off for the session (fallback rules)', () => {
  it('refuses inline code that the sandbox would have run, and does not rewrite the call', () => {
    const answer = hook(bash('python3 -c "print(1)"', 'oss:code-reviewer'), { OSS_TOOL_GATE_SANDBOX: 'off' });
    expect(answer.status).toBe(2);
    expect(answer.stderr).toContain('sandbox');
    const read = hook(bash('git status --short', 'oss:code-reviewer'), { OSS_TOOL_GATE_SANDBOX: 'off' });
    expect(read.status).toBe(0);
    expect(read.stdout).not.toContain('updatedInput');
  });
});

describe('fallback rules for review agents when no sandbox can be used (D4)', () => {
  async function fallbackGate(command: string, agent = 'oss:code-reviewer'): Promise<GateResult> {
    return runToolGate(
      { mode: 'pre', input: JSON.stringify(bash(command, agent)), env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo, TMPDIR: os.tmpdir() } },
      { platform: 'linux' },
    );
  }

  const refused = [
    'python3 -c "print(1)"',
    'python -c "print(1)"',
    'node -e "1"',
    'node -p "1"',
    'node --eval "1"',
    'bash -c "echo hi"',
    'sh -c "echo hi"',
    'zsh -c "echo hi"',
    'perl -e "print 1"',
    'ruby -e "puts 1"',
    'php -r "echo 1;"',
    'osascript -e "1"',
    'deno eval "1"',
    'bun -e "1"',
    "awk 'BEGIN { system(\"id\") }'",
    'python3 /tmp/x.py',
    'bash /tmp/x.sh',
    'node /tmp/x.js',
    'find . -name a -exec sh -c "echo {}" \\;',
  ];
  for (const command of refused) {
    it(`refuses \`${command}\``, async () => {
      const result = await fallbackGate(command);
      expect(result.exitCode).toBe(2);
    });
  }

  it('refuses the penetration tester a script from temp too', async () => {
    expect((await fallbackGate('python3 /tmp/x.py', 'oss:penetration-tester')).exitCode).toBe(2);
  });

  it("still allows the repo's own script and reads, with no rewrite (marked with the one fixed note, round 10)", async () => {
    for (const command of ['bash check.sh', 'git status --short', 'grep -rn needle .']) {
      expect(await fallbackGate(command), command).toEqual({ exitCode: 0, stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: OUTSIDE_SANDBOX_NOTE } })}\n`, stderr: '' });
    }
  });

  it('leaves builders unchanged', async () => {
    expect((await fallbackGate('python3 -c "print(1)"', 'oss:typescript-pro')).exitCode).toBe(0);
  });
});

describe('the gate with a named pipe planted at its event log (HIGH-2)', () => {
  it('still refuses a review agent in under a second through the CLI, instead of hanging on the pipe (bounded at 15 s)', () => {
    const project = path.join(caseRoot, 'fifo-project');
    fs.mkdirSync(path.join(project, '.oss/tool-gates'), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'feat/x'], { cwd: project });
    execFileSync('/usr/bin/mkfifo', [path.join(project, '.oss/tool-gates/events.ndjson')]);
    const input = { ...bash('echo x > file.txt', 'oss:code-reviewer'), cwd: project };
    const started = Date.now();
    const run = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'watcher/dist/cli/tool-gate.cjs'), 'pre'], {
      input: JSON.stringify(input),
      env: { HOME, PATH: '/usr/bin:/bin', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: project, TMPDIR: os.tmpdir() },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('gate-agent-write');
    expect(Date.now() - started).toBeLessThan(1000);
  }, 20_000);
});
