/**
 * @behavior When a build starts, the hook's real workflow-state writer stamps it, and the tool
 *   gate reads that same stamp: source edits need a failing test while the build runs, and the
 *   rule switches off once the build ends.
 * @business-rule ADR-008: "this build" is identified by the build's start stamp. Starting the
 *   same command again keeps the stamp; a new build gets a new one. The RED-rule unit tests mock
 *   WorkflowState, so this file checks that mock against the real writer (update-workflow-state
 *   CLI, as hooks/oss-notify.sh calls it) and the real reader (fileWorkflowState).
 * @boundary update-workflow-state CLI (watcher/dist) -> .oss/workflow-state.json ->
 *   fileWorkflowState / runToolGate
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileWorkflowState } from '../../src/tool-gate/workflow-state.js';
import { runToolGate, type GateMode, type GateResult } from '../../src/tool-gate/gate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '../../..');
const STATE_CLI = path.resolve(HERE, '../../dist/cli/update-workflow-state.js');
const HOME = os.homedir();

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function git(repo: string, args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore', timeout: 10000 });
}

/** A throwaway project folder with an empty `.oss`, as a repo has before its first command. */
function makeProject(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-wf-gate-')));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oss'));
  return dir;
}

/** A throwaway git repo on a feature branch, with one source file. */
function makeRepoOnFeatureBranch(): string {
  const repo = makeProject();
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Tool Gate Test']);
  git(repo, ['config', 'user.email', 'tool-gate-test@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'initial']);
  git(repo, ['checkout', '-q', '-b', 'feat/x']);
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const a = 1;\n');
  return repo;
}

/** The real writer, called the way hooks/oss-notify.sh calls it. */
function workflowState(projectDir: string, ...args: string[]): void {
  execFileSync('node', [STATE_CLI, '--project-dir', projectDir, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
  });
}

function stampOf(projectDir: string): string | null {
  return fileWorkflowState(projectDir).read()?.currentCommandStartedAt ?? null;
}

function gate(repo: string, mode: GateMode, hook: object): Promise<GateResult> {
  return runToolGate({
    mode,
    input: JSON.stringify(hook),
    env: { HOME, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: repo },
  });
}

function editApp(repo: string): object {
  return {
    session_id: 's1',
    cwd: repo,
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: path.join(repo, 'src', 'app.ts'), old_string: 'a = 1', new_string: 'a = 2' },
  };
}

function npmTestFailed(repo: string): object {
  return {
    session_id: 's1',
    cwd: repo,
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    error: 'Exit code 1',
    is_interrupt: false,
  };
}

describe('workflow state: the hook writer and the tool gate agree', () => {
  it('the gate sees the build the hook started, with its start time', () => {
    // Given: a project with no command running
    const dir = makeProject();

    // When: the hook announces that the build started
    workflowState(dir, 'setCurrentCommand', 'build');

    // Then: the gate reads the build and a valid ISO start time
    const snapshot = fileWorkflowState(dir).read();
    expect(snapshot?.currentCommand).toBe('build');
    const stamp = snapshot?.currentCommandStartedAt;
    expect(typeof stamp).toBe('string');
    expect(new Date(stamp as string).toISOString()).toBe(stamp);
  });

  it('announcing the same build again keeps its start time', () => {
    // Given: a build is running
    const dir = makeProject();
    workflowState(dir, 'setCurrentCommand', 'build');
    const first = stampOf(dir);

    // When: the hook announces the build again
    workflowState(dir, 'setCurrentCommand', 'build');

    // Then: the gate still sees the same start time
    expect(first).not.toBeNull();
    expect(stampOf(dir)).toBe(first);
  });

  it('a new build after the last one ended gets a new start time', () => {
    // Given: a build ran and ended
    const dir = makeProject();
    workflowState(dir, 'setCurrentCommand', 'build');
    const first = stampOf(dir) as string;
    const endedAt = Date.now();
    workflowState(dir, 'clearCurrentCommand');

    // When: a new build starts
    workflowState(dir, 'setCurrentCommand', 'build');

    // Then: the start time was written again, no earlier than when the last build ended
    const second = stampOf(dir) as string;
    expect(new Date(second).toISOString()).toBe(second);
    expect(new Date(second).getTime()).toBeGreaterThanOrEqual(endedAt);
    // The clock moved on since the first stamp, so the two must differ (same millisecond can't tell).
    if (new Date(first).getTime() < endedAt) expect(second).not.toBe(first);
  });

  it('during a build the gate refuses a source edit until a failing test is recorded', async () => {
    // Given: a repo on a feature branch, and the hook started the build
    const repo = makeRepoOnFeatureBranch();
    workflowState(repo, 'setCurrentCommand', 'build');

    // When: the agent edits a source file before running any test
    const refused = await gate(repo, 'pre', editApp(repo));

    // Then: the edit is refused
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain('No failing test recorded');

    // When: npm test fails, and the agent edits the same file again
    const recorded = await gate(repo, 'post', npmTestFailed(repo));
    const allowed = await gate(repo, 'pre', editApp(repo));

    // Then: the failing run is recorded and the edit goes ahead
    expect(recorded.exitCode).toBe(0);
    expect(allowed.exitCode).toBe(0);
  });

  it('once the build ends the gate lets source edits through without a test run', async () => {
    // Given: a build started and then ended, with no test ever run
    const repo = makeRepoOnFeatureBranch();
    workflowState(repo, 'setCurrentCommand', 'build');
    workflowState(repo, 'clearCurrentCommand');

    // When: the agent edits a source file
    const result = await gate(repo, 'pre', editApp(repo));

    // Then: the edit goes ahead
    expect(result.exitCode).toBe(0);
  });
});
