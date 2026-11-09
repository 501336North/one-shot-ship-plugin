/**
 * @behavior tool-gate checks each agent tool call against the IRON LAWS before it runs,
 *   refuses the ones that break them (exit 2 with a one-line reason), records test runs
 *   after they finish, and never blocks a session when it breaks itself.
 * @user-story US-001 Refuse commits and pushes on a protected branch
 * @user-story US-002 Refuse force pushes
 * @user-story US-003 Refuse focusing or skipping tests
 * @user-story US-004 Require a failing test before a source edit during a build
 * @user-story US-005 Record test runs as red or green
 * @user-story US-006 Protect the gate's own rules and state
 * @user-story US-007 Refuse calls to production hosts
 * @user-story US-008 Refuse tags when a repo turns them off
 * @user-story US-009 A repo rule file may only tighten the rules
 * @user-story US-010 A broken gate never blocks the session
 * @user-story US-011 Events for the benchmark
 * @boundary runToolGate (watcher/src/tool-gate/gate.ts), fed Claude Code hook JSON
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runToolGate, type GateDeps, type GateMode, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const tempDirs: string[] = [];

function git(repo: string, args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

/** A throwaway git repo on `main` with one empty commit. */
function makeRepo(): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-tool-gate-')));
  tempDirs.push(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Tool Gate Test']);
  git(repo, ['config', 'user.email', 'tool-gate-test@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'initial']);
  return repo;
}

function onBranch(repo: string, branch: string): void {
  git(repo, ['checkout', '-q', '-b', branch]);
}

function writeRepoFile(repo: string, relPath: string, content: string): string {
  const abs = path.join(repo, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function writeRepoRules(repo: string, rules: object): void {
  writeRepoFile(repo, '.oss/tool-gates.json', JSON.stringify(rules));
}

function startBuild(repo: string): void {
  writeRepoFile(
    repo,
    '.oss/workflow-state.json',
    JSON.stringify({ currentCommand: 'build', currentCommandStartedAt: '2026-11-09T00:00:00.000Z' })
  );
}

function eventsFile(repo: string): string {
  return path.join(repo, '.oss', 'tool-gates', 'events.ndjson');
}

function readEventLines(repo: string): string[] {
  const file = eventsFile(repo);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

function gate(mode: GateMode, hook: object, deps: GateDeps = {}): Promise<GateResult> {
  return runToolGate(
    {
      mode,
      input: JSON.stringify(hook),
      env: { HOME: process.env.HOME!, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    },
    deps
  );
}

function preBash(repo: string, command: string): object {
  return {
    session_id: 's1',
    cwd: repo,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  };
}

function preEdit(repo: string, filePath: string, oldString: string, newString: string): object {
  return {
    session_id: 's1',
    cwd: repo,
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: oldString, new_string: newString },
  };
}

function preWrite(repo: string, filePath: string, content: string): object {
  return {
    session_id: 's1',
    cwd: repo,
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
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

describe('tool-gate acceptance: IRON LAW gates at the hook boundary', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('US-001: protected branches', () => {
    it('refuses a push from main and names the branch (AC-001.1)', async () => {
      // Given: a repo on main
      const repo = makeRepo();

      // When: the agent runs git push
      const result = await gate('pre', preBash(repo, 'git push'));

      // Then: the call is refused and the reason names main
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('main');
    });

    it('allows a push from a feature branch without saying anything (AC-001.2)', async () => {
      // Given: a repo on a feature branch
      const repo = makeRepo();
      onBranch(repo, 'feat/x');

      // When: the agent runs git push
      const result = await gate('pre', preBash(repo, 'git push'));

      // Then: the call goes ahead with no output (never a permission decision)
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
    });
  });

  describe('US-002: force pushes', () => {
    it('refuses a force push even from a feature branch (AC-002.1)', async () => {
      // Given: a repo on a feature branch
      const repo = makeRepo();
      onBranch(repo, 'feat/x');

      // When: the agent runs git push --force
      const result = await gate('pre', preBash(repo, 'git push --force'));

      // Then: the call is refused
      expect(result.exitCode).toBe(2);
    });
  });

  describe('US-003: focused or skipped tests', () => {
    it('refuses writing a test file that focuses one test with .only (AC-003.1)', async () => {
      // Given: a repo on a feature branch
      const repo = makeRepo();
      onBranch(repo, 'feat/x');

      // When: the agent writes a test file containing it.only(
      const result = await gate(
        'pre',
        preWrite(repo, path.join(repo, 'src', 'foo.test.ts'), "it.only('works', () => {});\n")
      );

      // Then: the write is refused
      expect(result.exitCode).toBe(2);
    });
  });

  describe('US-004 / US-005: a failing test before source edits during a build', () => {
    it('refuses a source edit during a build when no test run is recorded (AC-004.1, AC-004.8)', async () => {
      // Given: a build is running and no test has been run yet
      const repo = makeRepo();
      onBranch(repo, 'feat/x');
      startBuild(repo);
      const appFile = writeRepoFile(repo, 'src/app.ts', 'export const a = 1;\n');

      // When: the agent edits a source file
      const result = await gate('pre', preEdit(repo, appFile, 'a = 1', 'a = 2'));

      // Then: the edit is refused and the agent is told a failing test is missing
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('No failing test recorded');
    });

    it('records a failing test run, then allows the source edit (AC-004.2, AC-005.2)', async () => {
      // Given: a build is running
      const repo = makeRepo();
      onBranch(repo, 'feat/x');
      startBuild(repo);
      const appFile = writeRepoFile(repo, 'src/app.ts', 'export const a = 1;\n');

      // When: npm test fails, and then the agent edits a source file
      await gate('post', postBashFailed(repo, 'npm test'));
      const result = await gate('pre', preEdit(repo, appFile, 'a = 1', 'a = 2'));

      // Then: the edit goes ahead
      expect(result.exitCode).toBe(0);
    });
  });

  describe("US-006: the gate's own rules and state are protected", () => {
    it("refuses writing the repo rule file (AC-006.1)", async () => {
      // Given: a repo on a feature branch
      const repo = makeRepo();
      onBranch(repo, 'feat/x');

      // When: the agent writes .oss/tool-gates.json
      const result = await gate(
        'pre',
        preWrite(repo, path.join(repo, '.oss', 'tool-gates.json'), '{ "version": 1 }')
      );

      // Then: the write is refused
      expect(result.exitCode).toBe(2);
    });

    it('refuses writing the recorded test cycle, so a red run cannot be faked (plan decision 2)', async () => {
      // Given: a repo on a feature branch
      const repo = makeRepo();
      onBranch(repo, 'feat/x');

      // When: the agent writes .oss/tool-gates/cycle.json
      const result = await gate(
        'pre',
        preWrite(repo, path.join(repo, '.oss', 'tool-gates', 'cycle.json'), '{ "result": "red" }')
      );

      // Then: the write is refused
      expect(result.exitCode).toBe(2);
    });
  });

  describe('US-007: production hosts', () => {
    it('refuses calling a production host the repo lists (AC-007.1)', async () => {
      // Given: the repo lists api.example.com as a production host
      const repo = makeRepo();
      onBranch(repo, 'feat/x');
      writeRepoRules(repo, { version: 1, productionHosts: ['api.example.com'] });

      // When: the agent curls that host
      const result = await gate('pre', preBash(repo, 'curl https://api.example.com/x'));

      // Then: the call is refused
      expect(result.exitCode).toBe(2);
    });
  });

  describe('US-008: tags', () => {
    it('refuses creating a tag when the repo turns tags off (AC-008.1)', async () => {
      // Given: the repo sets tagsAllowed to false
      const repo = makeRepo();
      onBranch(repo, 'feat/x');
      writeRepoRules(repo, { version: 1, tagsAllowed: false });

      // When: the agent runs git tag v1
      const result = await gate('pre', preBash(repo, 'git tag v1'));

      // Then: the call is refused
      expect(result.exitCode).toBe(2);
    });
  });

  describe('US-009: a repo rule file may only tighten the rules', () => {
    it('ignores and reports a repo rule file that drops main from the protected branches (AC-009.3)', async () => {
      // Given: a repo on main whose rule file protects only master
      const repo = makeRepo();
      writeRepoRules(repo, { version: 1, protectedBranches: ['master'] });

      // When: the agent runs git push
      const result = await gate('pre', preBash(repo, 'git push'));

      // Then: the base rules still refuse the push, and the agent is told the repo file was ignored
      expect(result.exitCode).toBe(2);
      expect(`${result.stdout}\n${result.stderr}`).toContain('tool-gates.json');
    });
  });

  describe('US-010: a broken gate never blocks the session', () => {
    it('allows the call and says "tool-gate failed, rules not checked." when reading git fails (AC-010.1)', async () => {
      // Given: reading the current branch throws
      const repo = makeRepo();
      const deps: GateDeps = {
        gitReader: {
          currentBranch: () => {
            throw new Error('git exploded');
          },
        },
      };

      // When: the agent runs git push
      const result = await gate('pre', preBash(repo, 'git push'), deps);

      // Then: the call goes ahead, the agent is told the rules were not checked, and a gate-error is logged
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('tool-gate failed, rules not checked.');
      const kinds = readEventLines(repo).map((line) => (JSON.parse(line) as { kind?: unknown }).kind);
      expect(kinds).toContain('gate-error');
    });
  });

  describe('US-011: events for the benchmark', () => {
    it('writes one event line with time, tool, kind and result for a refused push (AC-011.1)', async () => {
      // Given: a repo on main
      const repo = makeRepo();

      // When: the agent's git push is refused
      const result = await gate('pre', preBash(repo, 'git push'));

      // Then: exactly one JSON event line is written with the required fields
      expect(result.exitCode).toBe(2);
      const lines = readEventLines(repo);
      expect(lines).toHaveLength(1);
      const event = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(event).toHaveProperty('ts');
      expect(event).toHaveProperty('tool');
      expect(event).toHaveProperty('kind');
      expect(event).toHaveProperty('result');
    });

    it('never puts the written content into the events (AC-011.2)', async () => {
      // Given: a repo on a feature branch
      const repo = makeRepo();
      onBranch(repo, 'feat/x');

      // When: the agent's write of a focused test is refused
      const result = await gate(
        'pre',
        preWrite(repo, path.join(repo, 'src', 'foo.test.ts'), "SECRET_CONTENT_MARKER it.only('x', () => {});\n")
      );

      // Then: an event is logged but it does not contain the content
      expect(result.exitCode).toBe(2);
      expect(fs.existsSync(eventsFile(repo))).toBe(true);
      expect(fs.readFileSync(eventsFile(repo), 'utf8')).not.toContain('SECRET_CONTENT_MARKER');
    });
  });
});
