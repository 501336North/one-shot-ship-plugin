/**
 * @behavior A review agent's run is checked for any repo change: the repo's files are recorded
 *   when the review agent starts and compared when it ends. If anything a review could have judged
 *   changed meanwhile, the review is void and the main agent (or, for a background run, the user)
 *   is told which files changed and to stop the ship and ask the user. Builder runs are not checked.
 * @business-rule A review is only worth something if the code it judged is the code that ships.
 * @user-story US-008 Any repo change during a review voids it (R-266, ADR-007, ADR-009)
 * @boundary runGateRun (watcher/src/gate-run/gate-run.ts), fed Claude Code hook JSON from
 *   SubagentStart, SubagentStop and the `Agent` PostToolUse (shapes from probe P1, NOTES.md)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runGateRun, type GateRunEvent, type GateRunResult } from '../../src/gate-run/gate-run.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const tempDirs: string[] = [];

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

/** A throwaway git repo on a feature branch with one tracked file and one ignore rule. */
function makeRepo(): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-gate-run-')));
  tempDirs.push(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Gate Run Test']);
  git(repo, ['config', 'user.email', 'gate-run-test@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.log\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'initial']);
  git(repo, ['checkout', '-q', '-b', 'feat/review']);
  return repo;
}

function run(event: GateRunEvent, hook: object): Promise<GateRunResult> {
  return runGateRun({
    event,
    input: JSON.stringify(hook),
    env: { HOME: process.env.HOME!, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  });
}

function subagentStart(repo: string, agentId: string, agentType: string): object {
  return {
    session_id: 's1',
    cwd: repo,
    hook_event_name: 'SubagentStart',
    agent_id: agentId,
    agent_type: agentType,
  };
}

function subagentStop(repo: string, agentId: string, agentType: string): object {
  return {
    session_id: 's1',
    cwd: repo,
    hook_event_name: 'SubagentStop',
    agent_id: agentId,
    agent_type: agentType,
    stop_hook_active: false,
    last_assistant_message: 'Review done: no blocking findings.',
  };
}

/** The main agent's foreground `Agent` call finishing (PostToolUse). */
function agentPost(repo: string, agentId: string, agentType: string): object {
  return {
    session_id: 's1',
    cwd: repo,
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_use_id: 'toolu_review_1',
    tool_input: {
      subagent_type: agentType,
      description: 'Review the change',
      prompt: 'Review the diff on this branch.',
    },
    tool_response: {
      agentId,
      agentType,
      status: 'completed',
      content: [{ type: 'text', text: 'Review done: no blocking findings.' }],
    },
  };
}

/** Every file path under a folder, relative to it, sorted. */
function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(path.relative(dir, abs));
    }
  };
  walk(dir);
  return out.sort();
}

interface AdditionalContextOutput {
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
}

interface SystemMessageOutput {
  systemMessage: string;
}

describe('gate-run check: a repo change during a review run voids the review (R-266, US-008)', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tells the main agent the review is void, which files changed, and to stop the ship and ask the user (AC-008.1)', async () => {
    // Given: a review agent starts on a clean repo
    const repo = makeRepo();
    expect((await run('subagent-start', subagentStart(repo, 'agent-a', 'oss:code-reviewer'))).exitCode).toBe(0);

    // When: a tracked file changes and a new file appears while it runs, then the run ends
    fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const a = 2;\n');
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'added during review\n');
    expect((await run('subagent-stop', subagentStop(repo, 'agent-a', 'oss:code-reviewer'))).exitCode).toBe(0);
    const result = await run('agent-post', agentPost(repo, 'agent-a', 'oss:code-reviewer'));

    // Then: the main agent is told, without blocking the call
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as AdditionalContextOutput;
    expect(output.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    const message = output.hookSpecificOutput.additionalContext;
    expect(message).toMatch(/void/i);
    expect(message).toContain('src/app.ts');
    expect(message).toContain('notes.txt');
    expect(message).toMatch(/stop the ship/i);
    expect(message).toMatch(/ask the user/i);
  });

  it('says nothing when a review run changed nothing (AC-008.2)', async () => {
    // Given: a review agent starts
    const repo = makeRepo();
    await run('subagent-start', subagentStart(repo, 'agent-b', 'oss:code-reviewer'));

    // When: it ends without any change to the repo
    const stop = await run('subagent-stop', subagentStop(repo, 'agent-b', 'oss:code-reviewer'));
    const post = await run('agent-post', agentPost(repo, 'agent-b', 'oss:code-reviewer'));

    // Then: nothing is said
    expect(stop).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    expect(post).toEqual({ exitCode: 0, stdout: '', stderr: '' });
  });

  it('does not check a builder run: nothing is said and nothing is recorded (AC-008.3)', async () => {
    // Given: a repo and the state folders before a builder agent runs
    const repo = makeRepo();
    const gitDirBefore = listFiles(path.join(repo, '.git'));
    const homeBefore = listFiles(process.env.HOME!);

    // When: a builder agent changes a file during its run
    const start = await run('subagent-start', subagentStart(repo, 'agent-c', 'oss:typescript-pro'));
    fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const a = 3;\n');
    const stop = await run('subagent-stop', subagentStop(repo, 'agent-c', 'oss:typescript-pro'));
    const post = await run('agent-post', agentPost(repo, 'agent-c', 'oss:typescript-pro'));

    // Then: nothing is said, and no snapshot was taken or stored anywhere
    expect(start).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    expect(stop).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    expect(post).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    expect(listFiles(path.join(repo, '.git'))).toEqual(gitDirBefore);
    expect(listFiles(process.env.HOME!)).toEqual(homeBefore);
  });

  it('does not see a change to a gitignored file (recorded limit)', async () => {
    // Given: a review agent starts
    const repo = makeRepo();
    await run('subagent-start', subagentStart(repo, 'agent-d', 'oss:code-reviewer'));

    // When: only an ignored file is written during the run
    fs.writeFileSync(path.join(repo, 'ignored.log'), 'test output\n');
    const stop = await run('subagent-stop', subagentStop(repo, 'agent-d', 'oss:code-reviewer'));
    const post = await run('agent-post', agentPost(repo, 'agent-d', 'oss:code-reviewer'));

    // Then: nothing is said
    expect(stop).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    expect(post).toEqual({ exitCode: 0, stdout: '', stderr: '' });
  });

  it('tells the user when a background review run changed the repo, since no Agent result follows it (ADR-009)', async () => {
    // Given: a review agent started in the background
    const repo = makeRepo();
    await run('subagent-start', subagentStart(repo, 'agent-e', 'oss:security-auditor'));

    // When: a file changes and the run ends, with no Agent PostToolUse after it
    fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const a = 4;\n');
    const stop = await run('subagent-stop', subagentStop(repo, 'agent-e', 'oss:security-auditor'));

    // Then: the user is told the review is void and which file changed
    expect(stop.exitCode).toBe(0);
    const output = JSON.parse(stop.stdout) as SystemMessageOutput;
    expect(output.systemMessage).toMatch(/void/i);
    expect(output.systemMessage).toContain('src/app.ts');
  });

  it("leaves the repo's real staging area as it was", async () => {
    // Given: a repo with a staged change and an unstaged one
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged\n');
    git(repo, ['add', 'staged.txt']);
    fs.writeFileSync(path.join(repo, 'unstaged.txt'), 'not staged\n');
    const stagedBefore = git(repo, ['diff', '--cached', '--name-only']);
    const indexBefore = git(repo, ['ls-files', '--stage']);

    // When: a review run starts, a file changes, and the run ends
    await run('subagent-start', subagentStart(repo, 'agent-f', 'oss:code-reviewer'));
    fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const a = 5;\n');
    await run('subagent-stop', subagentStop(repo, 'agent-f', 'oss:code-reviewer'));
    await run('agent-post', agentPost(repo, 'agent-f', 'oss:code-reviewer'));

    // Then: what is staged is exactly what was staged before
    expect(git(repo, ['diff', '--cached', '--name-only'])).toBe(stagedBefore);
    expect(git(repo, ['ls-files', '--stage'])).toBe(indexBefore);
  });
});
