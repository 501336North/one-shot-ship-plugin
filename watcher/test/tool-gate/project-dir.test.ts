/**
 * @behavior The gate finds the project from Claude Code's CLAUDE_PROJECT_DIR when it is set
 *   (an absolute path to an existing folder), whatever folder the agent has moved into. A
 *   `.git` folder the agent plants in a subfolder can therefore not move the rule files, the
 *   protected paths, the recorded test cycle or the build state. Without the variable, the
 *   nearest folder holding `.git` is the project, as before.
 * @business-rule US-004 / US-006: the RED rule and the protected paths can't be escaped by
 *   changing folders. Test-file patterns anchored at the repo root match from any subfolder.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runToolGate, type GateMode, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const tempDirs: string[] = [];

/** A throwaway git repo on a feature branch with one empty commit. */
function makeRepo(): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-tool-gate-project-')));
  tempDirs.push(repo);
  for (const args of [
    ['init', '-q', '-b', 'feat/x'],
    ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'initial'],
  ]) {
    execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  }
  return repo;
}

function writeRepoFile(repo: string, relPath: string, content: string): string {
  const abs = path.join(repo, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

/** A subfolder holding a planted, empty `.git` folder, as `mkdir -p sub/.git && cd sub` leaves it. */
function plantedGitFolder(repo: string): string {
  const sub = path.join(repo, 'sub');
  fs.mkdirSync(path.join(sub, '.git'), { recursive: true });
  return sub;
}

function startBuild(repo: string): void {
  writeRepoFile(
    repo,
    '.oss/workflow-state.json',
    JSON.stringify({ currentCommand: 'build', currentCommandStartedAt: '2026-11-09T00:00:00.000Z' }),
  );
}

function gate(mode: GateMode, hook: object, projectDir?: string): Promise<GateResult> {
  return runToolGate({
    mode,
    input: JSON.stringify(hook),
    env: { HOME: process.env.HOME!, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: projectDir },
  });
}

function preWrite(cwd: string, filePath: string, content: string): object {
  return { cwd, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: filePath, content } };
}

function preEdit(cwd: string, filePath: string): object {
  return {
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: 'a = 1', new_string: 'a = 2' },
  };
}

function eventKinds(repo: string): unknown[] {
  const file = path.join(repo, '.oss', 'tool-gates', 'events.ndjson');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => (JSON.parse(line) as { kind?: unknown }).kind);
}

describe('tool-gate project folder: CLAUDE_PROJECT_DIR first, the nearest .git otherwise', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it("should refuse writing the repo's rule file from a subfolder holding a planted .git", async () => {
    // Given: Claude Code names the repo as the project, and the agent works in a subfolder with its own .git
    const repo = makeRepo();
    const sub = plantedGitFolder(repo);

    // When: the agent writes the repo's .oss/tool-gates.json
    const result = await gate('pre', preWrite(sub, path.join(repo, '.oss', 'tool-gates.json'), '{}'), repo);

    // Then: the write is refused and the refusal is logged in the repo, not in the subfolder
    expect(result.exitCode).toBe(2);
    expect(eventKinds(repo)).toEqual(['refusal']);
  });

  it('should refuse a source edit in a build with no recorded run, from a subfolder holding a planted .git', async () => {
    // Given: a build runs in the repo, no test has run, and the agent works in a subfolder with its own .git
    const repo = makeRepo();
    startBuild(repo);
    const appFile = writeRepoFile(repo, 'src/app.ts', 'export const a = 1;\n');
    const sub = plantedGitFolder(repo);

    // When: the agent edits a source file
    const result = await gate('pre', preEdit(sub, appFile), repo);

    // Then: the edit is refused until a test goes red
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('No failing test recorded');
  });

  it('should use the nearest .git folder when CLAUDE_PROJECT_DIR is unset or not an existing absolute folder', async () => {
    // Given: the agent works in a plain subfolder of the repo
    const repo = makeRepo();
    const sub = path.join(repo, 'lib');
    fs.mkdirSync(sub);
    const ruleFile = path.join(repo, '.oss', 'tool-gates.json');

    // When: the agent writes the repo's rule file, with no project folder, a relative one, and a missing one
    const results = await Promise.all([
      gate('pre', preWrite(sub, ruleFile, '{}')),
      gate('pre', preWrite(sub, ruleFile, '{}'), 'relative/project'),
      gate('pre', preWrite(sub, ruleFile, '{}'), path.join(repo, 'missing')),
    ]);

    // Then: each write is refused, the repo being found from its .git
    expect(results.map((result) => result.exitCode)).toEqual([2, 2, 2]);
  });

  it("should match a repo-anchored test-file pattern from a subfolder when adopting a build's runner", async () => {
    // Given: the repo adds e2e/*.js to the test-file patterns, and a build runs
    const repo = makeRepo();
    const base = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'tool-gates.json'), 'utf8')) as {
      testFilePatterns: string[];
    };
    writeRepoFile(
      repo,
      '.oss/tool-gates.json',
      JSON.stringify({ version: 1, testFilePatterns: [...base.testFilePatterns, 'e2e/*.js'] }),
    );
    startBuild(repo);
    const e2e = path.join(repo, 'e2e');
    writeRepoFile(repo, 'e2e/flow.js', '');

    // When: `node flow.js`, run in e2e/, fails
    await gate(
      'post',
      {
        cwd: e2e,
        hook_event_name: 'PostToolUseFailure',
        tool_name: 'Bash',
        tool_input: { command: 'node flow.js' },
        error: 'Exit code 1',
        is_interrupt: false,
      },
      repo,
    );

    // Then: it is adopted as the build's test runner and counted red
    expect(eventKinds(repo)).toEqual(['runner-adopted', 'test-run']);
  });
});
