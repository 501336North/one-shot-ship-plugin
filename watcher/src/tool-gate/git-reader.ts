/**
 * Git reader for the tool gate: which branch a directory is on. A collaborator, mocked in
 * the rule tests. Runs git without a shell and with a short timeout.
 */

import { execFileSync } from 'node:child_process';

export interface GitReader {
  /** The short branch name, or null for a detached HEAD, a non-repo, or any error. */
  currentBranch(dir: string): string | null;
}

export const realGitReader: GitReader = {
  currentBranch(dir) {
    try {
      const out = execFileSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1500,
        encoding: 'utf8',
      }).trim();
      return out === '' ? null : out;
    } catch {
      return null;
    }
  },
};
