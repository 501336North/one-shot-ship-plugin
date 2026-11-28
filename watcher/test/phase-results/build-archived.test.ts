/**
 * @behavior After the ship archived the dev docs, a fix round through /oss:build on the same branch finds the feature
 *           in the single completed folder the branch added, as ship does. ideate and plan never look there. The build
 *           path never asks GitHub for a merge proof and never records a ready row.
 * @business-rule D2 (complete-gaps, from D1): build gets the D84 archived-folder lookup with every D84/D85/D86 rule
 *           unchanged; the merge proof, --record-ready and D86 5c stay ship-only; ideate and plan do not get it.
 * @boundary main() of watcher/src/cli/phase-result.ts, called in process; git is real; the merge-ready collaborator
 *           (GitHub merge proof) is mocked at its module interface.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mergedReady = vi.hoisted(() => vi.fn(() => ({ ok: false, reason: 'no_proof' })));
vi.mock('../../src/phase-results/merge-ready.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/phase-results/merge-ready.js')>()),
  mergedReady,
}));

vi.setConfig({ testTimeout: 60_000 });

const COMPLETED = '.oss/dev/completed/mine-2026-11-23/results';
let tmp: string;
let repo: string;
let savedHome: string | undefined;

function git(...args: string[]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return execFileSync('git', args, { cwd: repo, env, encoding: 'utf-8' }).trim();
}

/** Runs the CLI's main() in process; returns its exit code and stderr. */
async function run(argv: string[]): Promise<{ rc: number; err: string }> {
  const quiet = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const mod = await import('../../src/cli/phase-result.js');
  process.exitCode = undefined;
  quiet.mockRestore();
  const err: string[] = [];
  const e = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  });
  const o = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const rc = mod.main([...argv, '--repo', repo]);
  e.mockRestore();
  o.mockRestore();
  return { rc, err: err.join('') };
}

/** The archive commit: the branch adds one completed folder of its feature, holding `files` under results/. */
function archive(files: string[]): void {
  fs.mkdirSync(path.join(repo, COMPLETED), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(repo, COMPLETED, f), '{}\n');
  fs.writeFileSync(path.join(repo, COMPLETED, '..', 'PLAN.md'), '# Plan\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'docs: archive');
}

beforeEach(() => {
  savedHome = process.env.HOME;
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'build-archived-')));
  process.env.HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.HOME);
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'main');
  git('checkout', '-q', '-b', 'feat/mine/build');
  mergedReady.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  process.env.HOME = savedHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('build after the archive commit finds the completed folder (D2)', () => {
  it('should resolve the archived folder for build when no active folder exists', async () => {
    archive(['build.unverified.json']);
    const { rc, err } = await run(['check', 'build']);
    expect(rc).toBe(1);
    // The unverified marker sits only in the completed folder, so this refusal proves build looked there.
    expect(err).toContain('unverified (field marker)');
    expect(err).not.toContain('no_feature');
  });

  it('should not run the archived lookup for ideate or plan', async () => {
    archive(['ideate.unverified.json', 'plan.unverified.json']);
    for (const phase of ['ideate', 'plan']) {
      const { rc, err } = await run(['check', phase]);
      expect(rc).toBe(1);
      expect(err).toContain('no_feature');
      expect(err).not.toContain('unverified');
    }
  });

  it('should never call the merge proof or record-ready on the build path', async () => {
    archive([]);
    const check = await run(['check', 'build']);
    expect(check.rc).toBe(1);
    expect(check.err).not.toContain('no_feature');
    const assemble = await run(['assemble', 'build']);
    expect(assemble.rc).not.toBe(0);
    const ready = await run(['check', 'build', '--record-ready']);
    expect(ready.rc).toBe(2);
    expect(mergedReady).not.toHaveBeenCalled();
  });
});
