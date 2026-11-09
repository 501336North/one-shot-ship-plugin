/**
 * @behavior When the tool gate itself breaks (a collaborator throws, or deciding takes over
 *   2 s), the agent's call goes ahead, a gate-error is logged and the agent is told the rules
 *   were not checked. A command the gate can't read is allowed and logged as unreadable. A
 *   rejected repo rule file is reported once per call while the base rules keep applying. An
 *   allowed call prints nothing and the gate never makes a permission decision.
 * @business-rule US-010 / ADR-005: a broken gate never blocks the session. Plan decision 5:
 *   allow is exit 0 with no stdout; never `permissionDecision`. AC-005.5: recording a test run
 *   starts no process.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runToolGate, type GateDeps, type GateMode, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TELL = 'tool-gate failed, rules not checked.';

const tempDirs: string[] = [];

function git(repo: string, args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

/** A throwaway git repo on `main` with one empty commit. */
function makeRepo(): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-tool-gate-failure-')));
  tempDirs.push(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Tool Gate Test']);
  git(repo, ['config', 'user.email', 'tool-gate-test@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'initial']);
  return repo;
}

function writeRepoFile(repo: string, relPath: string, content: string): string {
  const abs = path.join(repo, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function events(repo: string): Record<string, unknown>[] {
  const file = path.join(repo, '.oss', 'tool-gates', 'events.ndjson');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function gate(mode: GateMode, hook: object, deps: GateDeps = {}): Promise<GateResult> {
  return runToolGate(
    { mode, input: JSON.stringify(hook), env: { HOME: process.env.HOME!, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT } },
    deps,
  );
}

function preBash(repo: string, command: string): object {
  return { session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } };
}

function preEdit(repo: string, filePath: string): object {
  return {
    session_id: 's1',
    cwd: repo,
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: 'a = 1', new_string: 'a = 2' },
  };
}

function postBashFailed(repo: string, command: string): object {
  return {
    session_id: 's1',
    cwd: repo,
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Bash',
    tool_input: { command },
    error: 'Exit code 1\n1 failing test',
    is_interrupt: false,
  };
}

const TELL_STDOUT = { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: TELL } };

describe('tool-gate failure handling (US-010)', () => {
  afterEach(() => {
    vi.useRealTimers();
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('should allow, log gate-error and print the tell line when a collaborator throws', async () => {
    // Given: reading the current branch throws
    const repo = makeRepo();
    const deps: GateDeps = {
      gitReader: {
        currentBranch: () => {
          throw new Error('git exploded');
        },
      },
    };

    // When: the agent runs git commit
    const result = await gate('pre', preBash(repo, 'git commit -m x'), deps);

    // Then: the call goes ahead, the agent is told in one statement, and one gate-error is logged
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(TELL_STDOUT);
    expect(events(repo)).toEqual([expect.objectContaining({ tool: 'Bash', kind: 'gate-error', result: 'allowed' })]);
  });

  it('should allow, log gate-error and tell when the decision takes over 2 s', async () => {
    // Given: reading the current branch never finishes
    const repo = makeRepo();
    vi.useFakeTimers();
    const deps: GateDeps = { gitReader: { currentBranch: () => new Promise<string | null>(() => {}) } };

    // When: the agent runs git push and 2 s pass
    const pending = gate('pre', preBash(repo, 'git push'), deps);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    // Then: the call goes ahead, the agent is told, and a gate-error is logged
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(TELL_STDOUT);
    expect(events(repo).map((event) => event.kind)).toEqual(['gate-error']);
  });

  it('should allow and log unreadable for eval / $( … ) commands', async () => {
    // Given: a repo on main
    const repo = makeRepo();

    // When: the agent runs commands whose words are only known when they run
    const viaEval = await gate('pre', preBash(repo, 'eval "$CMD"'));
    const viaSubstitution = await gate('pre', preBash(repo, 'git push origin $(git branch --show-current)'));

    // Then: both go ahead silently and each is logged as unreadable with its command
    expect([viaEval, viaSubstitution]).toEqual([
      { exitCode: 0, stdout: '', stderr: '' },
      { exitCode: 0, stdout: '', stderr: '' },
    ]);
    expect(events(repo)).toEqual([
      expect.objectContaining({ tool: 'Bash', kind: 'unreadable', command: 'eval "$CMD"', result: 'allowed' }),
      expect.objectContaining({
        tool: 'Bash',
        kind: 'unreadable',
        command: 'git push origin $(git branch --show-current)',
        result: 'allowed',
      }),
    ]);
  });

  it("should print rule-file-rejected's one line once per call and still apply base rules", async () => {
    // Given: a repo on main whose rule file drops main from the protected branches
    const repo = makeRepo();
    writeRepoFile(repo, '.oss/tool-gates.json', JSON.stringify({ version: 1, protectedBranches: ['master'] }));

    // When: the agent runs an allowed command, then git push
    const allowed = await gate('pre', preBash(repo, 'git status'));
    const pushed = await gate('pre', preBash(repo, 'git push'));

    // Then: the allowed call goes ahead and says once, as context, that the file was ignored
    expect(allowed.exitCode).toBe(0);
    const context = (JSON.parse(allowed.stdout) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
    expect(context.split('.oss/tool-gates.json ignored')).toHaveLength(2);

    // And: the base rules still refuse the push from main, saying once that the file was ignored
    expect(pushed.exitCode).toBe(2);
    expect(pushed.stderr).toContain('`main`');
    expect(pushed.stderr.split('.oss/tool-gates.json ignored')).toHaveLength(2);

    // And: each call logs one rule-file-rejected event
    expect(events(repo).filter((event) => event.kind === 'rule-file-rejected')).toHaveLength(2);
  });

  it('should emit no stdout on allow and never a permissionDecision', async () => {
    // Given: a repo on a feature branch with a source file, outside a build
    const repo = makeRepo();
    git(repo, ['checkout', '-q', '-b', 'feat/x']);
    const appFile = writeRepoFile(repo, 'src/app.ts', 'export const a = 1;\n');
    const throwingGit: GateDeps = {
      gitReader: {
        currentBranch: () => {
          throw new Error('git exploded');
        },
      },
    };

    // When: the agent pushes, edits a source file, finishes a test run, and the gate breaks once
    const results = [
      await gate('pre', preBash(repo, 'git push')),
      await gate('pre', preEdit(repo, appFile)),
      await gate('post', postBashFailed(repo, 'npm test')),
    ];
    const broken = await gate('pre', preBash(repo, 'git push'), throwingGit);

    // Then: every allowed call prints nothing, and even the broken one makes no permission decision
    expect(results).toEqual([
      { exitCode: 0, stdout: '', stderr: '' },
      { exitCode: 0, stdout: '', stderr: '' },
      { exitCode: 0, stdout: '', stderr: '' },
    ]);
    expect(broken.exitCode).toBe(0);
    expect(broken.stdout).not.toContain('permissionDecision');
  });

  it('should record a test run after the call without reading git or running anything (AC-005.5)', async () => {
    // Given: a build is running, and git (the gate's only process-starting collaborator) must not be used
    const repo = makeRepo();
    writeRepoFile(
      repo,
      '.oss/workflow-state.json',
      JSON.stringify({ currentCommand: 'build', currentCommandStartedAt: '2026-11-09T00:00:00.000Z' }),
    );
    const currentBranch = vi.fn((): Promise<string | null> => {
      throw new Error('the recorder must not read git');
    });

    // When: npm test fails
    const result = await gate('post', postBashFailed(repo, 'npm test'), { gitReader: { currentBranch } });

    // Then: the run is recorded red from the hook event alone
    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    expect(currentBranch).not.toHaveBeenCalled();
    expect(events(repo)).toEqual([
      expect.objectContaining({ tool: 'Bash', kind: 'test-run', command: 'npm test', result: 'red' }),
    ]);
  });
});
