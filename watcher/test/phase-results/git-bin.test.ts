/**
 * The git binary the phase-result and Stop code runs (R-257 ship fix round 3, D33).
 *
 * @behavior A `git` planted early on PATH (by the model, a repo script or a dotfile) never decides a phase check:
 *           the ledger key, feature resolution and the git helpers all run a git from a fixed system location.
 * @business-rule gitBin() is the first regular executable of /usr/bin/git, /opt/homebrew/bin/git,
 *           /usr/local/bin/git, /bin/git (Homebrew paths sit at the recorded node's trust level, D33); never PATH.
 *           None found → '' so callers fail closed.
 * @boundary gitBin (git-bin.ts), gitOut (git.ts), ledgerKey (ledger.ts, which keeps its own copy because child
 *           processes import it with type stripping) and resolveFeature (feature.ts), with a real temp repo and a fake
 *           `git` first on PATH that records every call (the external process is the collaborator).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gitBin } from '../../src/phase-results/git-bin.js';
import { gitOut } from '../../src/phase-results/git.js';
import { ledgerKey } from '../../src/phase-results/ledger.js';
import { resolveFeature } from '../../src/phase-results/feature.js';

const FIXED = ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git', '/bin/git'];

let tmp: string;
let repo: string;
let calls: string;
let savedPath: string | undefined;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-bin-')));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  execFileSync('git', ['init', '-q', '-b', 'feat/f/build'], { cwd: repo, env });
  fs.mkdirSync(path.join(repo, '.oss', 'dev', 'active', 'f'), { recursive: true });
  const bin = path.join(tmp, 'fake-bin');
  fs.mkdirSync(bin);
  calls = path.join(tmp, 'git.calls');
  // A fake git that records the call and lies: it names another repo and another branch.
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "$*" >> '${calls}'\necho refs/heads/feat/evil/build\n`, { mode: 0o755 });
  savedPath = process.env.PATH;
  process.env.PATH = `${bin}:${savedPath ?? ''}`;
});

afterEach(() => {
  process.env.PATH = savedPath;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('gitBin (D33)', () => {
  // Rule: the answer is one of the fixed locations, never the PATH one.
  it('returns a fixed system git, not the one first on PATH', () => {
    const g = gitBin();
    expect(FIXED).toContain(g);
    expect(g).not.toBe(path.join(tmp, 'fake-bin', 'git'));
  });

  // User behaviour: no phase check result comes from a planted git.
  it('the git helpers, the ledger key and feature resolution never run the PATH git', () => {
    expect(gitOut(repo, ['rev-parse', '--show-toplevel'])).toBe(repo);
    expect(ledgerKey(repo)).toMatch(/^[0-9a-f]{16}$/);
    expect(resolveFeature(repo)).toBe('f');
    expect(fs.existsSync(calls)).toBe(false);
  });
});
