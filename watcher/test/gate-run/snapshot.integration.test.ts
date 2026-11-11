/**
 * @behavior When a review (gate) agent starts, the repo's files as they stand (tracked changes and
 *   new non-ignored files) are recorded as a git tree id, keyed by the run's agent id, in a state
 *   folder inside the repo's git dir. Builder agents are not recorded. The repo's real staging area
 *   is never touched, a symlinked state folder is refused, and an agent id that is not a plain file
 *   name is never used as a path.
 * @business-rule A review is only worth something if the code it judged is the code that ships, so
 *   the starting point of every review run must be recorded faithfully and safely.
 * @user-story US-008 Any repo change during a review voids it (R-266, ADR-007, ADR-009)
 * @boundary snapshotOnStart (watcher/src/gate-run/snapshot.ts), real temp git repos, real symlinks
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { snapshotOnStart } from '../../src/gate-run/snapshot.js';
import { readGateAgents } from '../../src/utils/gate-agents.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

/** A throwaway git repo with one tracked file and one ignore rule. */
function makeRepo(): string {
  const repo = tempDir('oss-snapshot-');
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Snapshot Test']);
  git(repo, ['config', 'user.email', 'snapshot-test@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.log\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'initial']);
  return repo;
}

function stateDir(repo: string): string {
  return path.join(git(repo, ['rev-parse', '--absolute-git-dir']).trim(), 'oss-gate-run');
}

function start(repo: string, agentId: unknown, agentType?: unknown): Record<string, unknown> {
  return { session_id: 's1', cwd: repo, hook_event_name: 'SubagentStart', agent_id: agentId, agent_type: agentType };
}

function gateAgents(repo: string): string[] {
  return readGateAgents(PLUGIN_ROOT, repo);
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

describe('snapshot when a review agent starts (R-266 Task 10)', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it.each(['oss:code-reviewer', 'code-reviewer'])('records a tree id keyed by agent_id for gate agent %s', (agentType) => {
    const repo = makeRepo();

    const tree = snapshotOnStart(start(repo, 'agent-1', agentType), gateAgents(repo));

    expect(tree).toMatch(/^[0-9a-f]{40,64}$/);
    expect(fs.readFileSync(path.join(stateDir(repo), 'agent-1'), 'utf8').trim()).toBe(tree);
  });

  it.each([
    ['a builder agent', 'oss:typescript-pro'],
    ['a missing agent_type', undefined],
    ['an unknown agent_type', 'oss:not-an-agent'],
  ])('records nothing for %s', (_label, agentType) => {
    const repo = makeRepo();
    const gitDirBefore = listFiles(path.join(repo, '.git'));

    const tree = snapshotOnStart(start(repo, 'agent-2', agentType), gateAgents(repo));

    expect(tree).toBeNull();
    expect(listFiles(path.join(repo, '.git'))).toEqual(gitDirBefore);
  });

  it('includes tracked changes and new non-ignored files, excludes ignored files, and leaves the real index alone', () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged\n');
    git(repo, ['add', 'staged.txt']);
    fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const a = 2;\n');
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'new\n');
    fs.writeFileSync(path.join(repo, 'ignored.log'), 'ignored\n');
    const indexBefore = git(repo, ['ls-files', '--stage']);
    const stagedBefore = git(repo, ['diff', '--cached']);

    const tree = snapshotOnStart(start(repo, 'agent-3', 'oss:security-auditor'), gateAgents(repo));

    const files = git(repo, ['ls-tree', '-r', '--name-only', tree!]).trim().split('\n').sort();
    expect(files).toEqual(['.gitignore', 'notes.txt', 'src/app.ts', 'staged.txt']);
    expect(git(repo, ['show', `${tree}:src/app.ts`])).toBe('export const a = 2;\n');
    expect(git(repo, ['ls-files', '--stage'])).toBe(indexBefore);
    expect(git(repo, ['diff', '--cached'])).toBe(stagedBefore);
  });

  it('refuses to write through a symlinked state folder and does not follow it', () => {
    const repo = makeRepo();
    const elsewhere = tempDir('oss-snapshot-elsewhere-');
    fs.symlinkSync(elsewhere, stateDir(repo));

    expect(() => snapshotOnStart(start(repo, 'agent-4', 'oss:code-reviewer'), gateAgents(repo))).toThrow();
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it.each([
    ['a path separator', 'a/b'],
    ['a parent folder', '..'],
    ['a parent path', '../escape'],
    ['an empty id', ''],
    ['a very long id', 'a'.repeat(300)],
    ['a non-string id', 42],
  ])('refuses an agent_id with %s and never uses it as a path', (_label, agentId) => {
    const repo = makeRepo();
    const gitDirBefore = listFiles(path.join(repo, '.git'));

    expect(() => snapshotOnStart(start(repo, agentId, 'oss:code-reviewer'), gateAgents(repo))).toThrow();
    expect(listFiles(path.join(repo, '.git'))).toEqual(gitDirBefore);
    expect(fs.existsSync(path.join(repo, 'escape'))).toBe(false);
  });
});
