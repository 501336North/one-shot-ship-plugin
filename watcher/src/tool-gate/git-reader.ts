/**
 * Git reader for the tool gate: which branch a directory is on. A collaborator, mocked in
 * the rule tests. Runs git without a shell and with a short timeout.
 */

import { execFile } from 'node:child_process';

export interface GitReader {
  /** The short branch name, or null for a detached HEAD, a non-repo, or any error. */
  currentBranch(dir: string): Promise<string | null>;
}

export const realGitReader: GitReader = {
  currentBranch(dir) {
    return new Promise((resolve) => {
      execFile('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: dir, timeout: 1500, encoding: 'utf8' }, (error, stdout) => {
        const out = error ? '' : stdout.trim();
        resolve(out === '' ? null : out);
      });
    });
  },
};
