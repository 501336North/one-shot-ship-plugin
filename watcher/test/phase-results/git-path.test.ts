/**
 * The PATH the phase-result and Stop code hands git (R-257 ship fix round 3, D33 follow-up).
 *
 * @behavior A program planted early on the caller's PATH never runs as one of git's helpers (ssh, pager, credential or
 *           fsmonitor hook, an alias) during a phase check.
 * @business-rule Every git child of git.ts (gitOut) and ledger.ts (ledgerKey) runs with PATH=/usr/bin:/bin, on top of
 *           the fixed git binary and the GIT_* stripping.
 * @boundary execFileSync (node:child_process) is the external-process collaborator: it is wrapped to record each call's
 *           env and still runs the real git, against a real temp repo.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const calls: Array<{ file: string; env: NodeJS.ProcessEnv | undefined }> = [];
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const wrapped = ((file: string, args: readonly string[], opts: { env?: NodeJS.ProcessEnv }) => {
    calls.push({ file, env: opts?.env });
    return actual.execFileSync(file, args, opts);
  }) as typeof actual.execFileSync;
  return { ...actual, execFileSync: wrapped };
});

const { gitOut } = await import('../../src/phase-results/git.js');
const { ledgerKey } = await import('../../src/phase-results/ledger.js');
const { execFileSync } = await import('node:child_process');

let repo: string;
let savedPath: string | undefined;

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-path-')));
  execFileSync('/usr/bin/git', ['init', '-q', repo], { env: { PATH: '/usr/bin:/bin' } });
  savedPath = process.env.PATH;
  process.env.PATH = `${path.join(repo, 'planted-bin')}:${savedPath ?? ''}`;
  calls.length = 0;
});

afterEach(() => {
  process.env.PATH = savedPath;
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("git's helpers never come from the caller's PATH", () => {
  // ⚠ changes existing test: D51 (security M2) — git now also gets GIT_NO_REPLACE_OBJECTS=1 and GIT_GRAFT_FILE=/dev/null
  //   (it was "no GIT_* variable" at all). No GIT_* variable from the caller's environment still reaches git, and a
  //   caller's own value for one of those two is replaced.
  it('gitOut runs git with PATH=/usr/bin:/bin and no caller GIT_* variable, only the D51 replace/graft switches', () => {
    process.env.GIT_DIR = '/nonexistent';
    process.env.GIT_NO_REPLACE_OBJECTS = '0';
    try {
      expect(gitOut(repo, ['rev-parse', '--show-toplevel'])).toBe(repo);
    } finally {
      delete process.env.GIT_DIR;
      delete process.env.GIT_NO_REPLACE_OBJECTS;
    }
    expect(calls).not.toHaveLength(0);
    for (const c of calls) {
      expect(c.env?.PATH).toBe('/usr/bin:/bin');
      const gitVars = Object.fromEntries(Object.entries(c.env ?? {}).filter(([k]) => k.startsWith('GIT_')));
      expect(gitVars).toEqual({ GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null' });
    }
  });

  it('ledgerKey runs git with PATH=/usr/bin:/bin', () => {
    expect(ledgerKey(repo)).toMatch(/^[0-9a-f]{16}$/);
    expect(calls).not.toHaveLength(0);
    for (const c of calls) expect(c.env?.PATH).toBe('/usr/bin:/bin');
  });
});
