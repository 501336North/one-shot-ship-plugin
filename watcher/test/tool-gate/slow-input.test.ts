/**
 * @behavior A Bash call built to make the gate slow is refused quickly instead of running past
 *   the gate's time limit: a word naming a path thousands of folders deep, braces that expand to
 *   millions of words, tens of thousands of empty `x=1;` parts, an interpreter script holding
 *   thousands of string literals, or a repo rule file adding thousands of protected globs. Each
 *   one is answered (refused, or the repo file rejected) well within 1 s.
 * @business-rule ADR-005: a gate slower than its limit allows the call, so slowness would be a
 *   way around every rule. Inputs over the gate's reading limits are refused, never checked slowly.
 * @boundary runToolGate in-process, real temp git repo on a feature branch, real file system.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runToolGate, type GateMode, type GateResult } from '../../src/tool-gate/gate.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** Generous: each of these is answered in a few milliseconds once its limit applies. */
const FAST_MS = 1000;

const tempDirs: string[] = [];

function git(repo: string, args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

/** A throwaway git repo on a feature branch with one empty commit. */
function makeRepo(): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-tool-gate-slow-')));
  tempDirs.push(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Tool Gate Test']);
  git(repo, ['config', 'user.email', 'tool-gate-test@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'initial']);
  git(repo, ['checkout', '-q', '-b', 'feat/slow']);
  return repo;
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

async function timed(mode: GateMode, repo: string, command: string, event = 'PreToolUse'): Promise<{ result: GateResult; ms: number }> {
  const input = JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: event, tool_name: 'Bash', tool_input: { command } });
  const started = performance.now();
  const result = await runToolGate({ mode, input, env: { HOME: process.env.HOME!, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT } });
  return { result, ms: performance.now() - started };
}

describe('tool-gate: inputs built to be slow are refused fast', () => {
  afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('should refuse a word naming a path 20000 folders deep before a push to main, within 1 s', async () => {
    const repo = makeRepo();

    const { result, ms } = await timed('pre', repo, `true ${'a/'.repeat(20_000)}x; git push origin main`);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('too long for the gate to check');
    expect(ms).toBeLessThan(FAST_MS);
  });

  it('should refuse braces that expand to millions of words within 1 s', async () => {
    const repo = makeRepo();

    const { result, ms } = await timed('pre', repo, `echo ${'{1..64}{1..4} '.repeat(30_000)}`);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('too many words');
    expect(ms).toBeLessThan(FAST_MS);
  });

  it('should not record a test run whose braces expand past the word limit, and answer within 1 s', async () => {
    const repo = makeRepo();

    const { result, ms } = await timed('post', repo, `npm test ${'{1..64}{1..4} '.repeat(30_000)}`, 'PostToolUse');

    expect(result.exitCode).toBe(0);
    expect(events(repo).filter((e) => e.kind === 'test-run')).toEqual([]);
    expect(ms).toBeLessThan(FAST_MS);
  });

  it('should refuse 30000 empty `x=1;` parts before a push to main within 1 s', async () => {
    const repo = makeRepo();

    const { result, ms } = await timed('pre', repo, `${'x=1;'.repeat(30_000)} git push origin main`);

    expect(result.exitCode).toBe(2);
    expect(ms).toBeLessThan(FAST_MS);
  });

  it('should refuse an interpreter script holding thousands of string literals within 1 s', async () => {
    const repo = makeRepo();

    const { result, ms } = await timed('pre', repo, `python3 -c "${"'a' ".repeat(15_000)}"; git push origin main`);

    expect(result.exitCode).toBe(2);
    expect(ms).toBeLessThan(FAST_MS);
  });

  it('should reject a repo rule file adding 3000 protected globs, and still refuse a push to main within 1 s', async () => {
    const repo = makeRepo();
    const base = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'tool-gates.json'), 'utf8')) as { protectedPaths: string[] };
    const added = Array.from({ length: 3000 }, (_, i) => `g/${i}/**`);
    fs.mkdirSync(path.join(repo, '.oss'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.oss', 'tool-gates.json'),
      JSON.stringify({ version: 1, protectedPaths: [...base.protectedPaths, ...added] }),
    );
    const words = Array.from({ length: 2000 }, (_, i) => `w${i}`).join(' ');

    const { result, ms } = await timed('pre', repo, `true ${words}; git push origin main`);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('.oss/tool-gates.json ignored');
    expect(ms).toBeLessThan(FAST_MS);
  });
});
